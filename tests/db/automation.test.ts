/**
 * Notification delivery queue and scheduled automations.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateWorker, asService, asUser, asUserCommit, attempt, buildFixture, createPool, createShift, createUser, expectError, type Fixture } from "./helpers";

const db = createPool();
let f: Fixture;
beforeAll(async () => {
  f = await buildFixture(db);
});
afterAll(async () => {
  await db.end();
});

async function newWorker() {
  const user = await createUser(db, "autoWorker");
  const id = (await db.query(
    "insert into public.workers (agency_id, user_id, engagement_type, first_name, last_name, email) values ($1, $2, 'employee', 'Auto', 'Worker', $3) returning id",
    [f.agencyA, user, `auto-${user.slice(0, 8)}@example.test`],
  )).rows[0].id as string;
  await activateWorker(db, f.agencyA, id, "employee");
  return { id, user };
}

async function confirmed(worker: string, startOffsetMinutes: number) {
  const start = new Date(Date.now() + startOffsetMinutes * 60000);
  const s = await createShift(db, f, { start: start.toISOString(), end: new Date(start.getTime() + 6 * 3600_000).toISOString(), headcount: 2 });
  return (await db.query(
    "insert into public.shift_assignments (agency_id, shift_id, shift_position_id, worker_id, status, starts_at, ends_at) values ($1, $2, $3, $4, 'confirmed', now(), now()) returning id",
    [f.agencyA, s.shift, s.position, worker],
  )).rows[0].id as string;
}

const notify = (user: string, event: string, key: string) =>
  db.query("select app.notify($1, $2, $3, 'Title', 'Body', '/portal', null, null, $4)", [f.agencyA, user, event, key]);

describe("delivery queue", () => {
  it("queues email for important events, push only with a subscription, and respects preferences", async () => {
    const w = await newWorker();
    await notify(w.user, "shift.reminder", "k1");
    let rows = (await db.query("select d.channel from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.recipient_user_id = $1 and n.idempotency_key = 'k1' order by 1", [w.user])).rows;
    expect(rows.map((r) => r.channel)).toEqual(["email"]);

    await asUserCommit(db, w.user, (tx) => tx.query("select public.register_push_subscription('https://push.example.test/abc', 'p256', 'authkey', 'test')"));
    await asUserCommit(db, w.user, (tx) => tx.query("insert into public.notification_preferences (user_id, agency_id, event_type, channel, enabled) values ($1, $2, 'shift.reminder', 'email', false)", [w.user, f.agencyA]));
    await notify(w.user, "shift.reminder", "k2");
    rows = (await db.query("select d.channel from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.recipient_user_id = $1 and n.idempotency_key = 'k2' order by 1", [w.user])).rows;
    expect(rows.map((r) => r.channel)).toEqual(["push"]);

    // Low-importance events are not emailed by default.
    await notify(w.user, "shift.interest", "k3");
    rows = (await db.query("select d.channel from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.idempotency_key = 'k3' and n.recipient_user_id = $1", [w.user])).rows;
    expect(rows.map((r) => r.channel)).toEqual(["push"]);
  });

  it("only the service role claims and completes deliveries, with backoff and dead-lettering", async () => {
    const w = await newWorker();
    await notify(w.user, "invoice.overdue", "dl1");
    const id = (await db.query("select d.id from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.idempotency_key = 'dl1' and n.recipient_user_id = $1", [w.user])).rows[0].id;
    await asUser(db, w.user, async (tx) => {
      await expectError(attempt(tx, "select public.complete_notification_delivery($1, 'sent')", [id]), /permission denied|Not authorised/);
      await expectError(attempt(tx, "select * from public.claim_notification_deliveries(5)"), /permission denied|Not authorised/);
    });
    await db.query("update public.notification_deliveries set max_attempts = 2 where id = $1", [id]);
    const ctx = await asService(db, async (tx) => {
      await tx.query("update public.notification_deliveries set status = 'sending', attempts = 1 where id = $1", [id]);
      await tx.query("select public.complete_notification_delivery($1, 'failed', 'resend', null, 'timeout')", [id]);
      return (await tx.query("select * from public.delivery_context(array[$1]::uuid[])", [id])).rows[0];
    });
    expect(ctx.email).toContain("@");
    let d = (await db.query("select status, next_attempt_at > now() later from public.notification_deliveries where id = $1", [id])).rows[0];
    expect(d).toEqual({ status: "failed", later: true });
    await asService(db, async (tx) => {
      await tx.query("update public.notification_deliveries set attempts = 2 where id = $1", [id]);
      await tx.query("select public.complete_notification_delivery($1, 'failed', 'resend', null, 'timeout')", [id]);
    });
    d = (await db.query("select status from public.notification_deliveries where id = $1", [id])).rows[0];
    expect(d.status).toBe("dead");
  });
});

describe("scheduled automations", () => {
  it("sends reminders and missing check-in alerts once, and expires lapsed documents", async () => {
    const w = await newWorker();
    const upcoming = await confirmed(w.id, 60 * 6);
    const late = await confirmed(w.id, -60 * 2);
    // Expired verified document.
    const type = (await db.query("select id from public.document_types where agency_id = $1 and key = 'certificate'", [f.agencyA])).rows[0].id;
    const doc = (await db.query("insert into public.documents (agency_id, document_type_id, owner_type, worker_id, title) values ($1, $2, 'worker', $3, 'Old cert') returning id", [f.agencyA, type, w.id])).rows[0].id;
    await db.query("update public.documents set status = 'verified', expires_on = current_date - 1, current_version = 1 where id = $1", [doc]);

    const first = await asService(db, async (tx) => (await tx.query("select public.run_scheduled_automations() r")).rows[0].r);
    expect(first.shift_reminders).toBeGreaterThanOrEqual(1);
    expect(first.missing_check_ins).toBeGreaterThanOrEqual(1);
    expect(first.documents_expired).toBeGreaterThanOrEqual(1);
    await asService(db, (tx) => tx.query("select public.run_scheduled_automations()"));

    const count = async (key: string) => (await db.query("select count(*)::int n from public.notifications where idempotency_key = $1", [key])).rows[0].n;
    expect(await count(`shift-reminder-${upcoming}`)).toBe(1);
    expect(await count(`missing-checkin-worker-${late}`)).toBe(1);
    expect(await count(`missing-checkin-${late}`)).toBeGreaterThanOrEqual(1); // one per ops user
    expect((await db.query("select status from public.documents where id = $1", [doc])).rows[0].status).toBe("expired");
    await expectError(asUser(db, w.user, (tx) => tx.query("select public.run_scheduled_automations()")), /permission denied/);
  });
});
