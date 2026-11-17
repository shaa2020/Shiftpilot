/**
 * Documents, compliance reviews and GDPR workflows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, asUserCommit, attempt, buildFixture, createPool, expectError, type Fixture } from "./helpers";

const db = createPool();
let f: Fixture;
beforeAll(async () => {
  f = await buildFixture(db);
});
afterAll(async () => {
  await db.end();
});

async function workerDocument(certificate = false) {
  const type = (await db.query("select id from public.document_types where agency_id = $1 and key = 'certificate'", [f.agencyA])).rows[0].id;
  const doc = await asUserCommit(db, f.users.workerEmp1, async (tx) =>
    (await tx.query("insert into public.documents (agency_id, document_type_id, owner_type, worker_id, title, uploaded_by) values ($1, $2, 'worker', $3, 'Forklift certificate', $4) returning id", [f.agencyA, type, f.workers.emp1, f.users.workerEmp1])).rows[0].id as string,
  );
  await asUserCommit(db, f.users.workerEmp1, (tx) =>
    tx.query("insert into public.document_versions (agency_id, document_id, version, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 1, $3, 'cert.pdf', 'application/pdf', 1000, $4)", [f.agencyA, doc, `${f.agencyA}/${doc}/v1.pdf`, f.users.workerEmp1]),
  );
  if (certificate) {
    const cert = (await db.query("insert into public.certificates (agency_id, name) values ($1, $2) returning id", [f.agencyA, `Forklift ${Math.random()}`])).rows[0].id;
    await db.query("insert into public.worker_certificates (agency_id, worker_id, certificate_id, document_id) values ($1, $2, $3, $4)", [f.agencyA, f.workers.emp1, cert, doc]);
  }
  return doc;
}

describe("document verification", () => {
  it("only verifiers can verify; expiry is required for expiring types; linked certificates follow", async () => {
    const doc = await workerDocument(true);
    await asUser(db, f.users.workerEmp1, async (tx) => {
      await expectError(attempt(tx, "select public.verify_document($1, true, '2032-01-01')", [doc]), "Not authorised");
    });
    await asUser(db, f.users.adminA, async (tx) => {
      await expectError(attempt(tx, "select public.verify_document($1, true)", [doc]), "requires an expiry date");
    });
    await asUserCommit(db, f.users.adminA, (tx) => tx.query("select public.verify_document($1, true, '2032-01-01')", [doc]));
    expect((await db.query("select status, expires_on::text from public.documents where id = $1", [doc])).rows[0]).toEqual({ status: "verified", expires_on: "2032-01-01" });
    expect((await db.query("select status from public.worker_certificates where document_id = $1", [doc])).rows[0].status).toBe("verified");
    // A new version resets verification.
    await asUserCommit(db, f.users.workerEmp1, (tx) =>
      tx.query("insert into public.document_versions (agency_id, document_id, version, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 1, $3, 'cert2.pdf', 'application/pdf', 1200, $4)", [f.agencyA, doc, `${f.agencyA}/${doc}/v2.pdf`, f.users.workerEmp1]),
    );
    expect((await db.query("select status, current_version from public.documents where id = $1", [doc])).rows[0]).toEqual({ status: "pending", current_version: 2 });
  });

  it("a rejected document returns to pending when a new version is uploaded", async () => {
    const doc = await workerDocument();
    await asUserCommit(db, f.users.adminA, (tx) => tx.query("select public.verify_document($1, false, null, 'Photo is blurry')", [doc]));
    expect((await db.query("select status, rejection_reason from public.documents where id = $1", [doc])).rows[0]).toEqual({ status: "rejected", rejection_reason: "Photo is blurry" });
    await asUserCommit(db, f.users.workerEmp1, (tx) =>
      tx.query("insert into public.document_versions (agency_id, document_id, version, storage_path, file_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 1, $3, 'cert3.pdf', 'application/pdf', 900, $4)", [f.agencyA, doc, `${f.agencyA}/${doc}/v3.pdf`, f.users.workerEmp1]),
    );
    expect((await db.query("select status, rejection_reason from public.documents where id = $1", [doc])).rows[0]).toEqual({ status: "pending", rejection_reason: null });
    // Workers still cannot mark their own document verified.
    await asUser(db, f.users.workerEmp1, async (tx) => {
      await expectError(attempt(tx, "update public.documents set status = 'verified' where id = $1", [doc]), "authorised staff");
    });
  });

  it("shows each worker their own checklist only", async () => {
    await asUser(db, f.users.workerEmp1, async (tx) => {
      const rows = (await tx.query("select key, required from public.worker_document_checklist($1)", [f.workers.emp1])).rows;
      expect(rows.find((r) => r.key === "identity_verification")?.required).toBe(true);
      expect((await tx.query("select * from public.worker_document_checklist($1)", [f.workers.emp2])).rows).toEqual([]);
    });
  });
});

describe("compliance reviews", () => {
  it("regulated-position reviews unlock eligibility only after an approved decision", async () => {
    const review = await asUserCommit(db, f.users.adminA, async (tx) =>
      (await tx.query("insert into public.compliance_reviews (agency_id, review_type, worker_id, position_id, requested_by) values ($1, 'regulated_position', $2, $3, $4) returning id", [f.agencyA, f.workers.emp1, f.positions.cleanerA, f.users.adminA])).rows[0].id,
    );
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.decide_compliance_review($1, 'approved', 'Checked VCA and training')", [review]), "Not authorised");
    });
    await asUser(db, f.users.adminA, async (tx) => {
      await expectError(attempt(tx, "select public.decide_compliance_review($1, 'approved', 'short')", [review]), "at least 10");
    });
    await asUserCommit(db, f.users.adminA, (tx) => tx.query("select public.decide_compliance_review($1, 'approved', 'Checked VCA certificate and site induction')", [review]));
    await expectError(db.query("update public.compliance_reviews set rationale = 'changed' where id = $1", [review]), "cannot be changed");
  });
});

describe("GDPR", () => {
  it("exports a subject's data for privacy officers only and audits the export", async () => {
    const email = (await db.query("select email from public.workers where id = $1", [f.workers.emp1])).rows[0].email;
    const out = await asUser(db, f.users.adminA, async (tx) => (await tx.query("select public.export_subject_data($1, $2) d", [f.agencyA, email])).rows[0].d);
    expect(out.worker.id).toBe(f.workers.emp1);
    expect(Array.isArray(out.assignments)).toBe(true);
    await asUser(db, f.users.recruiterA, async (tx) => {
      await expectError(attempt(tx, "select public.export_subject_data($1, $2)", [f.agencyA, email]), "Not authorised");
    });
  });

  it("anonymises applications and only inactive workers, keeping retained records", async () => {
    const app = (await db.query(
      "insert into public.applications (agency_id, first_name, last_name, email, privacy_notice_version, privacy_acknowledged_at, retention_until) values ($1, 'Jan', 'Jansen', 'jan@example.nl', 'v1', now(), current_date - 1) returning id",
      [f.agencyA],
    )).rows[0].id;
    const res = await asService(db, async (tx) => (await tx.query("select public.apply_retention() r")).rows[0].r);
    expect(res.applications_anonymised).toBeGreaterThanOrEqual(1);
    expect((await db.query("select first_name, phone from public.applications where id = $1", [app])).rows[0]).toEqual({ first_name: "Anonymised", phone: null });

    await asUser(db, f.users.adminA, async (tx) => {
      await expectError(attempt(tx, "select public.anonymise_worker($1)", [f.workers.free1]), "Deactivate or archive");
    });
    await db.query("update public.workers set status = 'inactive' where id = $1", [f.workers.free1]);
    await asUserCommit(db, f.users.adminA, (tx) => tx.query("select public.anonymise_worker($1)", [f.workers.free1]));
    const w = (await db.query("select first_name, phone, user_id, status from public.workers where id = $1", [f.workers.free1])).rows[0];
    expect(w).toEqual({ first_name: "Anonymised", phone: null, user_id: null, status: "archived" });
    expect((await db.query("select count(*)::int n from public.freelancer_businesses where worker_id = $1", [f.workers.free1])).rows[0].n).toBe(1);
  });

  it("lets users file their own data requests, notifies privacy officers and hides others' requests", async () => {
    const agencies = await asUser(db, f.users.workerEmp1, async (tx) => (await tx.query("select agency_id from public.my_agencies()")).rows.map((r) => r.agency_id));
    expect(agencies).toEqual([f.agencyA]);
    const email = (await db.query("select email from public.profiles where id = $1", [f.users.workerEmp1])).rows[0].email;
    const id = await asUserCommit(db, f.users.workerEmp1, async (tx) =>
      (await tx.query("insert into public.data_subject_requests (agency_id, subject_user_id, subject_email, request_type) values ($1, $2, $3, 'export') returning id", [f.agencyA, f.users.workerEmp1, email])).rows[0].id as string,
    );
    // A user cannot file on someone else's behalf or close their own request.
    await asUser(db, f.users.workerEmp1, async (tx) => {
      await expectError(attempt(tx, "insert into public.data_subject_requests (agency_id, subject_user_id, subject_email, request_type) values ($1, $2, 'x@example.nl', 'erasure')", [f.agencyA, f.users.workerEmp2]), "row-level security");
      await tx.query("update public.data_subject_requests set status = 'completed', outcome = 'self', completed_at = now() where id = $1", [id]);
      expect((await tx.query("select status from public.data_subject_requests where id = $1", [id])).rows[0].status).toBe("received");
    });
    await asUser(db, f.users.client1Admin, async (tx) => {
      expect((await tx.query("select count(*)::int n from public.data_subject_requests where id = $1", [id])).rows[0].n).toBe(0);
    });
    const notified = (await db.query("select count(*)::int n from public.notifications where entity_id = $1 and recipient_user_id = $2", [id, f.users.adminA])).rows[0].n;
    expect(notified).toBe(1);
  });
});
