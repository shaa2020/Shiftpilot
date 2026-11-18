/**
 * Document requests: agency asks, worker uploads, agency verifies; reject
 * re-opens; cancel; reminders; tenancy and permission boundaries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, asUserCommit, attempt, buildFixture, createPool, expectError, type Fixture } from "./helpers";

const db = createPool();
let f: Fixture;
let certType: string;
beforeAll(async () => {
  f = await buildFixture(db);
  certType = (await db.query("select id from public.document_types where agency_id = $1 and key = 'certificate'", [f.agencyA])).rows[0].id;
});
afterAll(async () => {
  await db.end();
});

const upload = (doc: string, user: string, n = Math.random()) =>
  asUserCommit(db, user, (tx) =>
    tx.query(
      "insert into public.document_versions (agency_id, document_id, version, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 1, $3, 'file.pdf', 'application/pdf', 1000, $4)",
      [f.agencyA, doc, `${f.agencyA}/${doc}/${n}.pdf`, user],
    ),
  );
const request = async (row: string) => (await db.query("select * from public.document_requests where id = $1", [row])).rows[0];

describe("document requests", () => {
  it("full lifecycle: request → upload → reject reopens → upload → verify completes", async () => {
    const n = await asUserCommit(db, f.users.ownerA, async (tx) =>
      (await tx.query("select public.request_documents($1, $2, null, 'Bank statement (last 3 months)', 'For your wage payments', current_date + 7) n", [f.agencyA, [f.workers.emp1]])).rows[0].n,
    );
    expect(n).toBe(1);
    const req = (await db.query("select id, document_id, status from public.document_requests where worker_id = $1 and title like 'Bank statement%'", [f.workers.emp1])).rows[0];
    expect(req.status).toBe("open");
    const note = await db.query("select count(*)::int n from public.notifications where recipient_user_id = $1 and event_type = 'document.requested'", [f.users.workerEmp1]);
    expect(note.rows[0].n).toBeGreaterThan(0);

    // The worker sees the request with its document.
    await asUser(db, f.users.workerEmp1, async (tx) => {
      const rows = (await tx.query("select * from public.worker_document_requests($1)", [f.workers.emp1])).rows;
      expect(rows.find((r) => r.id === req.id)?.title).toBe("Bank statement (last 3 months)");
    });

    await upload(req.document_id, f.users.workerEmp1);
    expect((await request(req.id)).status).toBe("submitted");

    await asUserCommit(db, f.users.ownerA, (tx) => tx.query("select public.verify_document($1, false, null, 'The statement is unreadable')", [req.document_id]));
    expect((await request(req.id)).status).toBe("open");

    await upload(req.document_id, f.users.workerEmp1);
    expect((await request(req.id)).status).toBe("submitted");
    await asUserCommit(db, f.users.ownerA, (tx) => tx.query("select public.verify_document($1, true)", [req.document_id]));
    const done = await request(req.id);
    expect(done.status).toBe("completed");
    expect(done.completed_at).not.toBeNull();
  });

  it("requests a configured type on the worker's existing document and skips duplicates", async () => {
    const existing = await asUserCommit(db, f.users.workerEmp2, async (tx) =>
      (await tx.query("insert into public.documents (agency_id, document_type_id, owner_type, worker_id, title, uploaded_by) values ($1, $2, 'worker', $3, 'VCA', $4) returning id", [f.agencyA, certType, f.workers.emp2, f.users.workerEmp2])).rows[0].id,
    );
    const count = await asUserCommit(db, f.users.ownerA, async (tx) =>
      (await tx.query("select public.request_documents($1, $2, $3, null) n", [f.agencyA, [f.workers.emp2, f.workers.emp1], certType])).rows[0].n,
    );
    expect(count).toBe(2);
    const r2 = (await db.query("select document_id from public.document_requests where worker_id = $1 and document_type_id = $2", [f.workers.emp2, certType])).rows[0];
    expect(r2.document_id).toBe(existing);
    const again = await asUserCommit(db, f.users.ownerA, async (tx) =>
      (await tx.query("select public.request_documents($1, $2, $3, null) n", [f.agencyA, [f.workers.emp2], certType])).rows[0].n,
    );
    expect(again).toBe(0);
  });

  it("cancel archives an unused placeholder; reminders are rate limited", async () => {
    await asUserCommit(db, f.users.ownerA, (tx) => tx.query("select public.request_documents($1, $2, null, 'Proof of address')", [f.agencyA, [f.workers.free1]]));
    const r = (await db.query("select id, document_id from public.document_requests where worker_id = $1 and title = 'Proof of address'", [f.workers.free1])).rows[0];
    await asUserCommit(db, f.users.ownerA, (tx) => tx.query("select public.remind_document_request($1)", [r.id]));
    await asUser(db, f.users.ownerA, async (tx) => {
      await expectError(attempt(tx, "select public.remind_document_request($1)", [r.id]), "less than an hour");
    });
    await asUserCommit(db, f.users.ownerA, (tx) => tx.query("select public.cancel_document_request($1, 'Not needed')", [r.id]));
    expect((await request(r.id)).status).toBe("cancelled");
    expect((await db.query("select archived_at from public.documents where id = $1", [r.document_id])).rows[0].archived_at).not.toBeNull();
  });

  it("only document staff of the agency may request; workers see only their own", async () => {
    for (const u of [f.users.workerEmp1, f.users.client1Admin, f.users.ownerB, f.users.financeA]) {
      await asUser(db, u, async (tx) => {
        await expectError(attempt(tx, "select public.request_documents($1, $2, null, 'Passport copy')", [f.agencyA, [f.workers.emp1]]), "Not authorised");
      });
    }
    await asUser(db, f.users.workerEmp2, async (tx) => {
      expect((await tx.query("select 1 from public.document_requests where worker_id = $1", [f.workers.emp1])).rowCount).toBe(0);
      expect((await tx.query("select * from public.worker_document_requests($1)", [f.workers.emp1])).rowCount).toBe(0);
      await expectError(attempt(tx, "insert into public.document_requests (agency_id, worker_id, document_type_id, document_id, title) values ($1, $2, $3, gen_random_uuid(), 'x')", [f.agencyA, f.workers.emp2, certType]), "permission denied");
    });
    // Workers of another agency cannot be targeted.
    const n = await asUserCommit(db, f.users.ownerA, async (tx) => (await tx.query("select public.request_documents($1, $2, null, 'Payslip copy') n", [f.agencyA, [f.workers.b1]])).rows[0].n);
    expect(n).toBe(0);
  });

  it("overdue reminders run for the service role only", async () => {
    await asUserCommit(db, f.users.ownerA, (tx) => tx.query("select public.request_documents($1, $2, null, 'Signed contract')", [f.agencyA, [f.workers.emp2]]));
    await db.query("update public.document_requests set due_on = current_date - 2 where title = 'Signed contract' and worker_id = $1", [f.workers.emp2]);
    const sent = await asService(db, async (tx) => (await tx.query("select public.remind_overdue_document_requests() n")).rows[0].n);
    expect(sent).toBeGreaterThan(0);
    await asUser(db, f.users.ownerA, async (tx) => {
      await expectError(attempt(tx, "select public.remind_overdue_document_requests()"), "permission denied");
    });
  });
});
