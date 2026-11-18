/**
 * Corrections before approval change the times; corrections after approval
 * add an adjustment. Either way the billed minutes equal the corrected worked
 * minutes exactly once.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateWorker, asUser, asUserCommit, buildFixture, createPool, createShift, createUser, type Fixture } from "./helpers";

const db = createPool();
let f: Fixture;
beforeAll(async () => { f = await buildFixture(db); });
afterAll(async () => { await db.end(); });

let lastUser = "";
async function submittedTimesheet(start: string, end: string, brk = 30) {
  const user = await createUser(db, "corrWorker");
  const w = (await db.query("insert into public.workers (agency_id, user_id, engagement_type, first_name, last_name, email) values ($1, $2, 'employee', 'Cor', 'Rection', $3) returning id", [f.agencyA, user, `cor-${user.slice(0, 8)}@example.test`])).rows[0].id;
  await activateWorker(db, f.agencyA, w, "employee");
  const s = await createShift(db, f, { start, end, headcount: 2 });
  const a = (await db.query("insert into public.shift_assignments (agency_id, shift_id, shift_position_id, worker_id, status, starts_at, ends_at) values ($1, $2, $3, $4, 'confirmed', now(), now()) returning id", [f.agencyA, s.shift, s.position, w])).rows[0].id;
  await db.query("insert into public.shift_rate_snapshots (agency_id, assignment_id, client_hourly_rate, worker_pay_basis, worker_hourly_amount, employer_cost_percentage) values ($1, $2, 30, 'employee_wage', 15, 30)", [f.agencyA, a]);
  const ts = (await db.query(
    `insert into public.timesheets (agency_id, assignment_id, shift_id, worker_id, client_id, location_id, scheduled_start, scheduled_end, scheduled_break_minutes, actual_start, actual_end, break_minutes, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 30, $7, $8, $9, 'draft') returning id`,
    [f.agencyA, a, s.shift, w, f.clients.c1, f.locations.c1Main, start, end, brk])).rows[0].id as string;
  await db.query("select app.recalculate_timesheet($1)", [ts]); // draft: builds regular/overtime entries
  await db.query("update public.timesheets set status = 'submitted', submitted_at = now() where id = $1", [ts]);
  lastUser = user;
  return ts;
}
const billed = async (ts: string) =>
  (await asUser(db, f.users.financeA, (tx) => tx.query("select coalesce(sum(minutes), 0)::int m from public.timesheet_billing_preview($1)", [ts]))).rows[0].m as number;
const worked = async (ts: string) => (await db.query("select worked_minutes from public.timesheets where id = $1", [ts])).rows[0].worked_minutes as number;

describe("timesheet corrections", () => {
  it("dispute resolution bills the corrected hours once", async () => {
    // Monday 3 Mar 2031 08:00–16:00 UTC (09:00–17:00 local), 30 min break → 450 min
    const ts = await submittedTimesheet("2031-03-03T08:00:00Z", "2031-03-03T16:00:00Z");
    expect(await billed(ts)).toBe(450);
    await db.query("update public.timesheets set status = 'disputed' where id = $1", [ts]);
    await asUserCommit(db, f.users.adminA, (tx) => tx.query("select public.resolve_timesheet_dispute($1, '2031-03-03T08:00:00Z', '2031-03-03T15:00:00Z', 30, 'Left one hour early')", [ts]));
    expect(await worked(ts)).toBe(390);
    expect(await billed(ts)).toBe(390);
    // The audit ledger still records the change, and it totals the corrected minutes.
    const ledger = (await db.query("select sum(minutes)::int s from public.timesheet_entries where timesheet_id = $1", [ts])).rows[0].s;
    expect(ledger).toBe(390);
  });

  it("a worker correction on a submitted timesheet is billed once", async () => {
    const ts = await submittedTimesheet("2031-03-04T08:00:00Z", "2031-03-04T16:00:00Z");
    const c = (await db.query("insert into public.attendance_corrections (agency_id, timesheet_id, requested_by, requester_type, proposed_break_minutes, reason) values ($1, $2, $3, 'worker', 60, 'Break was longer') returning id", [f.agencyA, ts, lastUser])).rows[0].id;
    await asUserCommit(db, f.users.adminA, (tx) => tx.query("select public.decide_attendance_correction($1, true, 'ok')", [c]));
    expect(await worked(ts)).toBe(420);
    expect(await billed(ts)).toBe(420);
  });

  it("a correction after approval is recorded as an adjustment on frozen times", async () => {
    const ts = await submittedTimesheet("2031-03-05T08:00:00Z", "2031-03-05T16:00:00Z");
    await db.query("update public.timesheets set status = 'client_approved', client_approved_at = now() where id = $1", [ts]);
    await db.query("update public.timesheets set status = 'agency_approved', agency_approved_at = now() where id = $1", [ts]);
    const c = (await db.query("insert into public.attendance_corrections (agency_id, timesheet_id, requested_by, requester_type, proposed_end, reason) values ($1, $2, $3, 'worker', '2031-03-05T17:00:00Z', 'Stayed an hour longer') returning id", [f.agencyA, ts, lastUser])).rows[0].id;
    await asUserCommit(db, f.users.adminA, (tx) => tx.query("select public.decide_attendance_correction($1, true, 'Confirmed')", [c]));
    expect(await worked(ts)).toBe(450); // approved values unchanged
    expect(await billed(ts)).toBe(510); // +60 adjustment, counted once
  });
});
