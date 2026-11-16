/**
 * Attendance and timesheets: server time, idempotency, offline events,
 * location privacy, timesheet generation, approval workflow, disputes,
 * corrections after approval, alerts and client projections.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { activateWorker, asUser, asUserCommit, attempt, buildFixture, createPool, createShift, createUser, expectError, type Fixture } from "./helpers";

const db = createPool();
let f: Fixture;
let offset = 0;
void offset;

beforeAll(async () => {
  f = await buildFixture(db);
});
afterAll(async () => {
  await db.end();
});

/** A fresh active employee with its own login (avoids overlap between scenarios). */
async function newWorker(): Promise<{ id: string; user: string }> {
  const user = await createUser(db, "attWorker");
  const id = (await db.query(
    "insert into public.workers (agency_id, user_id, engagement_type, first_name, last_name, email) values ($1, $2, 'employee', 'Att', 'Worker', $3) returning id",
    [f.agencyA, user, `att-${user.slice(0, 8)}@example.test`],
  )).rows[0].id;
  await activateWorker(db, f.agencyA, id, "employee");
  return { id, user };
}

/** A confirmed assignment on a shift that started `startedMinutesAgo` minutes ago (8h long). */
async function confirmedAssignment(worker: string, startedMinutesAgo = 10, clientId = f.clients.c1, locationId = f.locations.c1Main) {
  offset += 1;
  const start = new Date(Date.now() - startedMinutesAgo * 60000);
  const end = new Date(start.getTime() + 8 * 3600_000);
  const s = await createShift(db, f, { start: start.toISOString(), end: end.toISOString(), clientId, locationId, headcount: 3 });
  const a = (await db.query(
    "insert into public.shift_assignments (agency_id, shift_id, shift_position_id, worker_id, status, starts_at, ends_at) values ($1, $2, $3, $4, 'confirmed', now(), now()) returning id",
    [f.agencyA, s.shift, s.position, worker],
  )).rows[0].id as string;
  return { ...s, assignment: a, start, end };
}

const record = (user: string, assignment: string, type: string, extra: Record<string, unknown> = {}) =>
  asUserCommit(db, user, (tx) =>
    tx.query("select public.record_attendance($1, $2, $3, $4, $5, $6, $7, $8) r", [
      assignment, type, (extra.key as string) ?? randomUUID(), extra.device ?? null, extra.offline ?? false, extra.lat ?? null, extra.lng ?? null, extra.acc ?? null,
    ]).then((r) => r.rows[0].r),
  );

async function cleanupAssignment(a: string) {
  // Free the worker's time slot for later tests (cancel if still active).
  await db.query("update public.shift_assignments set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'test cleanup' where id = $1 and status in ('confirmed','invited','accepted')", [a]);
}

describe("check-in and check-out", () => {
  it("records server-time events, breaks and builds a submitted timesheet", async () => {
    const w = await newWorker();
    const x = await confirmedAssignment(w.id);
    const r1 = await record(w.user, x.assignment, "check_in");
    expect(r1.status).toBe("checked_in");
    expect((await db.query("select status from public.shifts where id = $1", [x.shift])).rows[0].status).toBe("in_progress");
    await record(w.user, x.assignment, "break_start");
    await asUser(db, w.user, async (tx) => {
      await expectError(attempt(tx, "select public.record_attendance($1, 'break_start', $2)", [x.assignment, randomUUID()]), "already running");
    });
    await record(w.user, x.assignment, "break_end");
    const r2 = await record(w.user, x.assignment, "check_out");
    expect(r2.status).toBe("checked_out");

    const ts = (await db.query("select * from public.timesheets where assignment_id = $1", [x.assignment])).rows[0];
    expect(ts.status).toBe("submitted");
    expect(ts.actual_start).not.toBeNull();
    expect(ts.break_minutes).toBe(0); // the recorded break lasted < 1 minute
    expect(ts.has_offline_events).toBe(false);
    expect(ts.early_departure_minutes).toBeGreaterThan(400); // left right after starting
    // Check-out submits the timesheet, so the shift moves on to awaiting approval.
    expect((await db.query("select status from public.shifts where id = $1", [x.shift])).rows[0].status).toBe("awaiting_approval");
  });

  it("is idempotent per client-generated key", async () => {
    const w = await newWorker();
    const x = await confirmedAssignment(w.id);
    const key = randomUUID();
    const a = await record(w.user, x.assignment, "check_in", { key });
    const b = await record(w.user, x.assignment, "check_in", { key });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.event_id).toBe(a.event_id);
    expect((await db.query("select count(*)::int n from public.attendance_events where assignment_id = $1", [x.assignment])).rows[0].n).toBe(1);
    await record(w.user, x.assignment, "check_out");
  });

  it("keeps offline device time separately and flags the timesheet", async () => {
    const w = await newWorker();
    const x = await confirmedAssignment(w.id, 60);
    const device = new Date(Date.now() - 45 * 60000).toISOString();
    await record(w.user, x.assignment, "check_in", { offline: true, device });
    await record(w.user, x.assignment, "check_out");
    const ev = (await db.query("select device_recorded_at, server_recorded_at, is_offline_sync from public.attendance_events where assignment_id = $1 and event_type = 'check_in'", [x.assignment])).rows[0];
    expect(ev.is_offline_sync).toBe(true);
    expect(new Date(ev.device_recorded_at).toISOString()).toBe(device);
    expect(new Date(ev.server_recorded_at).getTime()).toBeGreaterThan(new Date(device).getTime());
    const ts = (await db.query("select has_offline_events, actual_start from public.timesheets where assignment_id = $1", [x.assignment])).rows[0];
    expect(ts.has_offline_events).toBe(true);
    expect(new Date(ts.actual_start).toISOString()).toBe(device);
    const w2 = await newWorker();
    await asUser(db, w2.user, async (tx) => {
      const y = await confirmedAssignment(w2.id, 30);
      await expectError(attempt(tx, "select public.record_attendance($1, 'check_in', $2, $3, true)", [y.assignment, randomUUID(), new Date(Date.now() + 3600_000).toISOString()]), "cannot be in the future");
      await cleanupAssignment(y.assignment);
    });
  });

  it("stores location only when the agency enabled verification", async () => {
    const w = await newWorker();
    const x = await confirmedAssignment(w.id, 5);
    await record(w.user, x.assignment, "check_in", { lat: 52.37, lng: 4.89, acc: 10 });
    expect((await db.query("select latitude from public.attendance_events where assignment_id = $1", [x.assignment])).rows[0].latitude).toBeNull();
    await record(w.user, x.assignment, "check_out");

    await db.query("update public.agency_settings set location_verification_enabled = true, location_privacy_notice = $2 where agency_id = $1", [f.agencyA, "Location is recorded only at check-in and check-out to confirm attendance at the client site."]);
    await db.query("update public.client_locations set latitude = 52.3731, longitude = 4.8922, geofence_radius_m = 200 where id = $1", [f.locations.c1Main]);
    const w2 = await newWorker();
    const y = await confirmedAssignment(w2.id, 5);
    await record(w2.user, y.assignment, "check_in", { lat: 52.3735, lng: 4.8925, acc: 15 });
    const ev = (await db.query("select latitude, location_verified from public.attendance_events where assignment_id = $1", [y.assignment])).rows[0];
    expect(ev.latitude).not.toBeNull();
    expect(ev.location_verified).toBe(true);
    await record(w2.user, y.assignment, "check_out");
    await db.query("update public.agency_settings set location_verification_enabled = false where agency_id = $1", [f.agencyA]);
  });

  it("rejects early check-in and other workers' assignments", async () => {
    const future = await createShift(db, f, { start: new Date(Date.now() + 5 * 3600_000).toISOString(), end: new Date(Date.now() + 9 * 3600_000).toISOString() });
    const a = (await db.query("insert into public.shift_assignments (agency_id, shift_id, shift_position_id, worker_id, status, starts_at, ends_at) values ($1, $2, $3, $4, 'confirmed', now(), now()) returning id", [f.agencyA, future.shift, future.position, f.workers.emp1])).rows[0].id;
    await asUser(db, f.users.workerEmp1, async (tx) => {
      await expectError(attempt(tx, "select public.record_attendance($1, 'check_in', $2)", [a, randomUUID()]), "two hours before");
    });
    await asUser(db, f.users.workerEmp2, async (tx) => {
      await expectError(attempt(tx, "select public.record_attendance($1, 'check_in', $2)", [a, randomUUID()]), "not found");
    });
    await cleanupAssignment(a);
  });
});

describe("timesheet approval", () => {
  async function submittedTimesheet() {
    const w = await newWorker();
    const user = w.user;
    const x = await confirmedAssignment(w.id, 15);
    await record(user, x.assignment, "check_in");
    await record(user, x.assignment, "check_out");
    const id = (await db.query("select id from public.timesheets where assignment_id = $1", [x.assignment])).rows[0].id as string;
    return { ...x, timesheet: id, user };
  }

  it("client approves, then agency approves; unauthorised users cannot", async () => {
    const t = await submittedTimesheet();
    for (const u of [f.users.client2Admin, f.users.client1Viewer, t.user]) {
      await asUser(db, u, async (tx) => {
        await expectError(attempt(tx, "select public.client_review_timesheet($1, true)", [t.timesheet]), "Not authorised");
      });
    }
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.agency_approve_timesheet($1)", [t.timesheet]), "client must approve");
    });
    await asUserCommit(db, f.users.client1Admin, (tx) => tx.query("select public.client_review_timesheet($1, true)", [t.timesheet]));
    await asUser(db, f.users.recruiterA, async (tx) => {
      await expectError(attempt(tx, "select public.agency_approve_timesheet($1)", [t.timesheet]), "Not authorised");
    });
    await asUserCommit(db, f.users.opsA, (tx) => tx.query("select public.agency_approve_timesheet($1)", [t.timesheet]));
    expect((await db.query("select status from public.timesheets where id = $1", [t.timesheet])).rows[0].status).toBe("agency_approved");
    expect((await db.query("select status from public.shift_assignments where id = $1", [t.assignment])).rows[0].status).toBe("completed");
    expect((await db.query("select status from public.shifts where id = $1", [t.shift])).rows[0].status).toBe("approved");
    const approvals = (await db.query("select approver_type, decision from public.timesheet_approvals where timesheet_id = $1 order by decided_at", [t.timesheet])).rows;
    expect(approvals).toEqual([{ approver_type: "client", decision: "approved" }, { approver_type: "agency", decision: "approved" }]);
    await asUser(db, t.user, async (tx) => {
      expect((await tx.query("select count(*)::int n from public.notifications where entity_id = $1 and event_type = 'timesheet.approved'", [t.timesheet])).rows[0].n).toBe(1);
    });
  });

  it("dispute → agency correction → resubmitted with an adjustment", async () => {
    const t = await submittedTimesheet();
    await asUser(db, f.users.client1Admin, async (tx) => {
      await expectError(attempt(tx, "select public.client_review_timesheet($1, false, 'no')", [t.timesheet]), "Explain");
    });
    await asUserCommit(db, f.users.client1Admin, (tx) => tx.query("select public.client_review_timesheet($1, false, 'Worker left at 15:00, not 16:30')", [t.timesheet]));
    expect((await db.query("select status from public.timesheets where id = $1", [t.timesheet])).rows[0].status).toBe("disputed");
    const start = t.start.toISOString();
    const end = new Date(t.start.getTime() + 6 * 3600_000).toISOString();
    await asUserCommit(db, f.users.opsA, (tx) => tx.query("select public.resolve_timesheet_dispute($1, $2, $3, 30, 'Agreed with client: left at 15:00')", [t.timesheet, start, end]));
    const ts = (await db.query("select status, worked_minutes from public.timesheets where id = $1", [t.timesheet])).rows[0];
    expect(ts).toEqual({ status: "submitted", worked_minutes: 330 });
    const sum = (await db.query("select sum(minutes)::int s from public.timesheet_entries where timesheet_id = $1", [t.timesheet])).rows[0].s;
    expect(sum).toBe(330);
  });

  it("corrections after approval become adjustments; approved values never change", async () => {
    const t = await submittedTimesheet();
    await asUserCommit(db, f.users.client1Admin, (tx) => tx.query("select public.client_review_timesheet($1, true)", [t.timesheet]));
    const before = (await db.query("select worked_minutes, actual_end from public.timesheets where id = $1", [t.timesheet])).rows[0];
    const corr = await asUserCommit(db, t.user, async (tx) =>
      (await tx.query(
        "insert into public.attendance_corrections (agency_id, timesheet_id, requested_by, requester_type, proposed_end, reason) values ($1, $2, $3, 'worker', $4, 'I forgot to check out at the end') returning id",
        [f.agencyA, t.timesheet, t.user, t.end.toISOString()],
      )).rows[0].id,
    );
    await asUser(db, t.user, async (tx) => {
      await expectError(attempt(tx, "select public.decide_attendance_correction($1, true, 'self')", [corr]), "Not authorised");
    });
    await asUserCommit(db, f.users.opsA, (tx) => tx.query("select public.decide_attendance_correction($1, true, 'Confirmed by site manager')", [corr]));
    const after = (await db.query("select worked_minutes, actual_end from public.timesheets where id = $1", [t.timesheet])).rows[0];
    expect(after).toEqual(before);
    const adj = (await db.query("select minutes, correction_id from public.timesheet_entries where timesheet_id = $1 and entry_kind = 'adjustment'", [t.timesheet])).rows;
    expect(adj).toHaveLength(1);
    expect(adj[0].correction_id).toBe(corr);
    expect(adj[0].minutes).toBeGreaterThan(400);
  });
});

describe("alerts and projections", () => {
  it("flags missing check-ins for staff only", async () => {
    const w = await newWorker();
    const x = await confirmedAssignment(w.id, 30); // alert threshold is 15 minutes
    await asUser(db, f.users.opsA, async (tx) => {
      const rows = (await tx.query("select alert, assignment_id from public.attendance_alerts($1)", [f.agencyA])).rows;
      expect(rows.some((r) => r.assignment_id === x.assignment && r.alert === "missing_check_in")).toBe(true);
    });
    await asUser(db, f.users.client1Admin, async (tx) => {
      expect((await tx.query("select count(*)::int n from public.attendance_alerts($1)", [f.agencyA])).rows[0].n).toBe(0);
    });
    await cleanupAssignment(x.assignment);
  });

  it("clients see who is on duty without wage data; workers see only their own pay", async () => {
    const w = await newWorker();
    const x = await confirmedAssignment(w.id, 5);
    await record(w.user, x.assignment, "check_in");
    await asUser(db, f.users.client1Admin, async (tx) => {
      const onDuty = (await tx.query("select * from public.client_on_duty($1)", [f.clients.c1])).rows;
      expect(onDuty.some((r) => r.shift_id === x.shift)).toBe(true);
      const staff = (await tx.query("select * from public.client_shift_staff($1)", [x.shift])).rows[0];
      expect(staff.checked_in_at).not.toBeNull();
      expect(Object.keys(staff)).not.toContain("hourly_amount");
      expect((await tx.query("select * from public.my_assignment_pay($1)", [x.assignment])).rows).toEqual([]);
    });
    await asUser(db, f.users.client2Admin, async (tx) => {
      expect((await tx.query("select * from public.client_on_duty($1)", [f.clients.c1])).rows).toEqual([]);
    });
    await asUser(db, w.user, async (tx) => {
      expect((await tx.query("select pay_basis from public.my_assignment_pay($1)", [x.assignment])).rows).toEqual([]); // no snapshot in this fixture
    });
    await record(w.user, x.assignment, "check_out");
  });
});
