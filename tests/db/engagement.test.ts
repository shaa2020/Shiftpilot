/**
 * Engagement features: branding, messaging, client ratings and preferred /
 * blocked workers (and their effect on matching), announcements and
 * calendar feeds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, attempt, buildFixture, createPool, createShift, expectError, sha256Hex, type Fixture, type Tx } from "./helpers";

const db = createPool();
let f: Fixture;
let day = 0;
function window() {
  day += 2;
  const start = new Date(Date.UTC(2031, 2, 1 + day, 8));
  return { start: start.toISOString(), end: new Date(start.getTime() + 6 * 3600_000).toISOString() };
}
const one = async (tx: Tx, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows[0];
/** Count notifications as the superuser (they are private to each recipient). */
async function notes(tx: Tx, entity: string, user: string) {
  await tx.query("reset role");
  const n = (await tx.query("select count(*)::int n from public.notifications where entity_id = $1 and recipient_user_id = $2", [entity, user])).rows[0].n as number;
  await tx.query("set local role authenticated");
  return n;
}

/** A finished assignment of `worker` at client c1 (main location). */
async function finishedAssignment(worker: string) {
  const s = await createShift(db, f, { ...window(), clientId: f.clients.c1, locationId: f.locations.c1Main });
  const a = await db.query(
    `insert into public.shift_assignments (agency_id, shift_id, shift_position_id, worker_id, status, starts_at, ends_at)
     select $1, $2, $3, $4, 'confirmed', starts_at, ends_at from public.shifts where id = $2 returning id`,
    [f.agencyA, s.shift, s.position, worker],
  );
  const id = a.rows[0].id as string;
  await db.query("update public.shift_assignments set status = 'checked_in' where id = $1", [id]);
  await db.query("update public.shift_assignments set status = 'checked_out' where id = $1", [id]);
  return { assignment: id, ...s };
}

beforeAll(async () => {
  f = await buildFixture(db);
});
afterAll(async () => {
  await db.end();
});

describe("branding", () => {
  it("settings managers write branding; every agency participant reads it; other agencies cannot", async () => {
    await asUser(db, f.users.ownerA, async (tx) => {
      await tx.query("insert into public.agency_branding (agency_id, brand_color, worker_welcome) values ($1, '#0f766e', 'Welcome!')", [f.agencyA]);
      await expectError(attempt(tx, "update public.agency_branding set brand_color = 'red' where agency_id = $1", [f.agencyA]), "check");
      for (const u of [f.users.workerEmp1, f.users.client1Admin]) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated" })]);
        expect((await one(tx, "select brand_color from public.agency_branding where agency_id = $1", [f.agencyA]))?.brand_color).toBe("#0f766e");
        const upd = await tx.query("update public.agency_branding set brand_color = '#000000' where agency_id = $1 returning 1", [f.agencyA]);
        expect(upd.rowCount).toBe(0);
      }
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.users.ownerB, role: "authenticated" })]);
      expect((await tx.query("select 1 from public.agency_branding where agency_id = $1", [f.agencyA])).rowCount).toBe(0);
    });
  });
});

describe("messaging", () => {
  it("staff message a worker; the worker replies; outsiders and other workers see nothing", async () => {
    await asUser(db, f.users.opsA, async (tx) => {
      const conv = (await one(tx, "select public.start_conversation($1, 'Shift tomorrow', 'Can you start at 7?', $2) id", [f.agencyA, f.workers.emp1])).id;
      expect(await notes(tx, conv, f.users.workerEmp1)).toBe(1);

      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.users.workerEmp1, role: "authenticated" })]);
      const inbox = (await tx.query("select * from public.my_conversations($1)", [f.agencyA])).rows;
      expect(inbox).toHaveLength(1);
      expect(inbox[0].unread).toBe(true);
      await tx.query("select public.send_message($1, 'Yes, see you then')", [conv]);
      await expectError(attempt(tx, "select public.send_message($1, 'secret', true)", [conv]), "Only agency staff");
      expect((await tx.query("select * from public.my_conversations($1)", [f.agencyA])).rows[0].unread).toBe(false);

      // Internal staff notes are hidden from the worker.
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.users.opsA, role: "authenticated" })]);
      await tx.query("select public.send_message($1, 'Reliable worker', true)", [conv]);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.users.workerEmp1, role: "authenticated" })]);
      const bodies = (await tx.query("select body from public.messages where conversation_id = $1 order by created_at", [conv])).rows.map((r) => r.body);
      expect(bodies).not.toContain("Reliable worker");

      for (const u of [f.users.workerEmp2, f.users.client1Admin, f.users.ownerB]) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated" })]);
        expect((await tx.query("select 1 from public.messages where conversation_id = $1", [conv])).rowCount).toBe(0);
        await expectError(attempt(tx, "select public.send_message($1, 'hi')", [conv]), "Not allowed");
      }
    });
  });

  it("a worker or client starts a thread with the agency and staff are notified", async () => {
    await asUser(db, f.users.workerEmp2, async (tx) => {
      const conv = (await one(tx, "select public.start_conversation($1, 'Holiday', 'I am away next week') id", [f.agencyA])).id;
      expect(await notes(tx, conv, f.users.opsA)).toBe(1);
      await expectError(attempt(tx, "select public.start_conversation($1, 'x', 'y', null, $2)", [f.agencyA, f.clients.c1]), "Not allowed");
    });
    await asUser(db, f.users.client1Admin, async (tx) => {
      const conv = (await one(tx, "select public.start_conversation($1, 'Invoice', 'Question about the invoice', null, $2) id", [f.agencyA, f.clients.c1])).id;
      expect(conv).toBeTruthy();
      await expectError(attempt(tx, "select public.start_conversation($1, 'x', 'y', null, $2)", [f.agencyA, f.clients.c2]), "Not allowed");
      await expectError(attempt(tx, "insert into public.conversation_participants (conversation_id, agency_id, user_id) values ($1, $2, $3)", [conv, f.agencyA, f.users.workerEmp1]), "row-level security");
    });
  });
});

describe("client feedback", () => {
  it("clients rate finished assignments at their own locations only", async () => {
    const done = await finishedAssignment(f.workers.emp1);
    await asUserCommit(db, f.users.client1Admin, async (tx) => {
      await tx.query("select public.rate_assignment($1, 5, 'Great work')", [done.assignment]);
      await tx.query("select public.rate_assignment($1, 4, 'Good')", [done.assignment]);
      expect((await one(tx, "select rating from public.worker_ratings where assignment_id = $1", [done.assignment])).rating).toBe(4);
    });
    await asUser(db, f.users.client1Admin, async (tx) => {
      await expectError(attempt(tx, "select public.rate_assignment($1, 7)", [done.assignment]), "between 1 and 5");
    });
    for (const u of [f.users.client2Admin, f.users.client1Viewer]) {
      await asUser(db, u, async (tx) => {
        await expectError(attempt(tx, "select public.rate_assignment($1, 1)", [done.assignment]), "Not allowed");
      });
    }
    await asUser(db, f.users.workerEmp1, async (tx) => {
      expect((await tx.query("select rating from public.worker_ratings where worker_id = $1", [f.workers.emp1])).rowCount).toBe(1);
    });
    await asUser(db, f.users.workerEmp2, async (tx) => {
      expect((await tx.query("select 1 from public.worker_ratings where worker_id = $1", [f.workers.emp1])).rowCount).toBe(0);
    });
  });

  it("blocked workers are ineligible for that client and preferred workers rank higher", async () => {
    await finishedAssignment(f.workers.emp2);
    const s = await createShift(db, f, { ...window(), clientId: f.clients.c1, locationId: f.locations.c1Main });
    const other = await createShift(db, f, { ...window(), clientId: f.clients.c2, locationId: f.locations.c2Main });
    await asUser(db, f.users.client1Admin, async (tx) => {
      const overview = (await tx.query("select * from public.client_worker_overview($1)", [f.clients.c1])).rows;
      expect(overview.map((r) => r.worker_id)).toEqual(expect.arrayContaining([f.workers.emp1, f.workers.emp2]));
      // Only workers who worked for the client can be chosen.
      await expectError(attempt(tx, "select public.set_worker_preference($1, $2, 'blocked')", [f.clients.c1, f.workers.free1]), "worked for you");
      await tx.query("select public.set_worker_preference($1, $2, 'blocked', 'Late twice')", [f.clients.c1, f.workers.emp2]);
      await tx.query("select public.set_worker_preference($1, $2, 'preferred')", [f.clients.c1, f.workers.emp1]);

      const blocked = await one(tx, "select app.evaluate_eligibility($1, $2) r", [s.position, f.workers.emp2]);
      expect(blocked.r.eligible).toBe(false);
      expect(blocked.r.failures).toContain("The client has asked not to receive this worker");
      const preferred = await one(tx, "select app.evaluate_eligibility($1, $2) r", [s.position, f.workers.emp1]);
      expect(preferred.r.notes).toContain("Preferred by this client");
      expect(preferred.r.explanation.client_preference).toBe("preferred");

      // Another client is unaffected by c1's block.
      expect((await one(tx, "select app.evaluate_eligibility($1, $2) r", [other.position, f.workers.emp2])).r.failures).not.toContain("The client has asked not to receive this worker");
    });
    // A client without request rights, and workers, cannot set or see preferences.
    await asUser(db, f.users.client1Viewer, async (tx) => {
      await expectError(attempt(tx, "select public.set_worker_preference($1, $2, null)", [f.clients.c1, f.workers.emp2]), "Not allowed");
    });
    await asUser(db, f.users.workerEmp2, async (tx) => {
      expect((await tx.query("select 1 from public.client_worker_preferences")).rowCount).toBe(0);
    });
  });
});

describe("announcements", () => {
  it("reach the chosen audience and notify them", async () => {
    await asUser(db, f.users.ownerA, async (tx) => {
      const a = (await one(tx, "insert into public.announcements (agency_id, title, body, audience, created_by) values ($1, 'New uniforms', 'Pick them up Monday', 'workers', $2) returning id", [f.agencyA, f.users.ownerA])).id;
      expect(await notes(tx, a, f.users.workerEmp1)).toBe(1);
      expect(await notes(tx, a, f.users.client1Admin)).toBe(0);

      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.users.workerEmp1, role: "authenticated" })]);
      expect((await tx.query("select 1 from public.announcements where id = $1", [a])).rowCount).toBe(1);
      await expectError(attempt(tx, "insert into public.announcements (agency_id, title, body, audience, created_by) values ($1, 'x', 'y', 'everyone', $2)", [f.agencyA, f.users.workerEmp1]), "row-level security");
      for (const u of [f.users.client1Admin, f.users.workerB1]) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated" })]);
        expect((await tx.query("select 1 from public.announcements where id = $1", [a])).rowCount).toBe(0);
      }
    });
  });
});

describe("calendar feeds", () => {
  it("return only the token owner's shifts, to anyone holding the token", async () => {
    const done = await finishedAssignment(f.workers.emp1);
    await db.query("update public.shift_assignments set starts_at = now() + interval '3 days', ends_at = now() + interval '3 days 4 hours' where id = $1", [done.assignment]).catch(() => undefined);
    const token = "feed-token-" + Math.random();
    await asUser(db, f.users.workerEmp1, async (tx) => {
      await tx.query("insert into public.calendar_feeds (user_id, token_hash) values ($1, $2)", [f.users.workerEmp1, sha256Hex(token)]);
      await expectError(attempt(tx, "insert into public.calendar_feeds (user_id, token_hash) values ($1, $2)", [f.users.workerEmp2, sha256Hex("x")]), "row-level security");
      await tx.query("set local role anon");
      await tx.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      const rows = (await tx.query("select * from public.calendar_feed_events($1)", [sha256Hex(token)])).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.client_name === "Client One")).toBe(true);
      expect((await tx.query("select * from public.calendar_feed_events($1)", [sha256Hex("wrong")])).rowCount).toBe(0);
      expect((await tx.query("select * from public.calendar_feed_events('not-a-hash')")).rowCount).toBe(0);
      await expectError(attempt(tx, "select * from public.calendar_feeds"), "permission denied");
    });
  });
});
