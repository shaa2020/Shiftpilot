/**
 * Scheduling engine: eligibility with explanations, overrides, confirmation
 * with rate snapshots, recurrence, request acceptance, replacement and
 * working-time rules.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserCommit, attempt, buildFixture, createPool, createShift, expectError, type Fixture } from "./helpers";

const db = createPool();
let f: Fixture;
let cert: string;
let day = 0;
function window(hours = 8, baseHour = 8) {
  day += 2;
  const start = new Date(Date.UTC(2030, 0, 1 + day, baseHour));
  return { start: start.toISOString(), end: new Date(start.getTime() + hours * 3600_000).toISOString() };
}
const rpc = (tx: import("./helpers").Tx, fn: string, args: unknown[]) =>
  tx.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) r`, args).then((r) => r.rows[0].r);

beforeAll(async () => {
  f = await buildFixture(db);
  // Mandatory certificate on the cleaner position; only emp1 holds a valid one.
  cert = (await db.query("insert into public.certificates (agency_id, name) values ($1, 'VCA Basic') returning id", [f.agencyA])).rows[0].id;
  await db.query(
    "insert into public.position_requirements (agency_id, position_id, requirement_type, certificate_id, is_mandatory) values ($1, $2, 'certificate', $3, true)",
    [f.agencyA, f.positions.cleanerA, cert],
  );
  await db.query(
    "insert into public.worker_certificates (agency_id, worker_id, certificate_id, status, expires_on) values ($1, $2, $3, 'verified', '2031-12-31'), ($1, $4, $3, 'verified', '2029-01-01')",
    [f.agencyA, f.workers.emp1, cert, f.workers.free1],
  );
  // Client rate card (active) with a base rate.
  const card = (await db.query(
    "insert into public.client_rate_cards (agency_id, client_id, name, effective_from) values ($1, $2, 'Standard 2030', '2029-01-01') returning id",
    [f.agencyA, f.clients.c1],
  )).rows[0].id;
  await db.query("insert into public.client_rate_rules (agency_id, rate_card_id, rule_kind, hourly_rate) values ($1, $2, 'base', 32.50)", [f.agencyA, card]);
  await db.query("insert into public.client_rate_rules (agency_id, rate_card_id, rule_kind, multiplier, days_of_week) values ($1, $2, 'weekend', 1.25, '{6,7}')", [f.agencyA, card]);
  await db.query("update public.client_rate_cards set status = 'active', approved_at = now() where id = $1", [card]);
});
afterAll(async () => {
  await db.end();
});

describe("eligibility", () => {
  it("explains mandatory failures and ranks eligible workers", async () => {
    const s = await createShift(db, f, window());
    await asUser(db, f.users.opsA, async (tx) => {
      const rows = (await tx.query("select * from public.find_eligible_workers($1, true)", [s.position])).rows;
      const emp1 = rows.find((r) => r.worker_id === f.workers.emp1);
      const emp2 = rows.find((r) => r.worker_id === f.workers.emp2);
      const free1 = rows.find((r) => r.worker_id === f.workers.free1);
      expect(emp1.eligible).toBe(true);
      expect(emp2.eligible).toBe(false);
      expect(emp2.failures).toContain('Missing required valid, verified certificate "VCA Basic"');
      expect(free1.eligible).toBe(false); // certificate expired before the shift
      const onlyEligible = (await tx.query("select worker_id from public.find_eligible_workers($1)", [s.position])).rows.map((r) => r.worker_id);
      expect(onlyEligible).toEqual([f.workers.emp1]);
    });
  });

  it("is not available to clients, recruiters or other workers", async () => {
    const s = await createShift(db, f, window());
    for (const u of [f.users.client1Admin, f.users.recruiterA]) {
      await asUser(db, u, async (tx) => {
        await expectError(attempt(tx, "select * from public.find_eligible_workers($1)", [s.position]), "Not authorised");
      });
    }
    await asUser(db, f.users.workerEmp2, async (tx) => {
      await expectError(attempt(tx, "select public.evaluate_worker_eligibility($1, $2)", [s.position, f.workers.emp1]), "Not authorised");
      const own = await rpc(tx, "evaluate_worker_eligibility", [s.position, f.workers.emp2]);
      expect(own.eligible).toBe(false);
    });
  });

  it("enforces configured working-time rules (minimum rest)", async () => {
    await db.query(
      `insert into public.compliance_rules (agency_id, rule_key, version, category, name, description, parameters, severity, source_reference, effective_from, status, approved_at)
       values ($1, 'working_time.min_rest', 1, 'working_time', 'Minimum rest', 'Rest between shifts', '{"min_rest_minutes": 660}', 'blocking', 'Agency policy (test)', '2029-01-01', 'active', now())`,
      [f.agencyA],
    );
    const evening = createShift(db, f, { start: "2030-06-10T14:00:00Z", end: "2030-06-10T20:00:00Z" });
    const early = createShift(db, f, { start: "2030-06-11T04:00:00Z", end: "2030-06-11T10:00:00Z", clientId: f.clients.c2, locationId: f.locations.c2Main });
    const [e1, e2] = await Promise.all([evening, early]);
    const a = await asUserCommit(db, f.users.opsA, (tx) => rpc(tx, "assign_worker", [e1.position, f.workers.emp1, null]));
    await asUserCommit(db, f.users.workerEmp1, (tx) => tx.query("select public.respond_to_assignment($1, true)", [a]));
    await asUser(db, f.users.opsA, async (tx) => {
      const ev = await rpc(tx, "evaluate_worker_eligibility", [e2.position, f.workers.emp1]);
      expect(ev.failures).toContain("Less than 11.0 hours rest between shifts");
    });
    await db.query("update public.compliance_rules set status = 'retired', effective_to = '2029-12-31' where agency_id = $1 and rule_key = 'working_time.min_rest'", [f.agencyA]);
  });
});

describe("overrides", () => {
  it("never overrides mandatory failures; warnings need a written reason", async () => {
    const s = await createShift(db, f, window());
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.assign_worker($1, $2, $3)", [s.position, f.workers.emp2, "Client asked for this person specifically"]), "Not eligible");
    });
    // Create a warning: the location is far beyond the worker's travel limit.
    await db.query("update public.client_locations set latitude = 53.2194, longitude = 6.5665 where id = $1", [f.locations.c1Main]); // Groningen
    await db.query("update public.workers set home_latitude = 51.9244, home_longitude = 4.4777, max_travel_km = 20 where id = $1", [f.workers.emp1]); // Rotterdam
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.assign_worker($1, $2)", [s.position, f.workers.emp1]), "override reason");
      const id = await rpc(tx, "assign_worker", [s.position, f.workers.emp1, "Worker agreed to travel; agency pays travel costs"]);
      const row = (await tx.query("select override_reason, override_by from public.shift_assignments where id = $1", [id])).rows[0];
      expect(row.override_reason).toContain("agency pays travel");
      expect(row.override_by).toBe(f.users.opsA);
    });
    await db.query("update public.workers set home_latitude = null, home_longitude = null, max_travel_km = null where id = $1", [f.workers.emp1]);
  });
});

describe("invite → accept → confirm", () => {
  it("notifies the worker, then freezes rates and eligibility at confirmation", async () => {
    const s = await createShift(db, f, window());
    const res = await asUserCommit(db, f.users.opsA, (tx) => rpc(tx, "invite_workers", [s.position, [f.workers.emp1, f.workers.emp2], null, null]));
    expect(res.invited).toBe(1);
    expect(res.skipped[0].reason).toMatch(/Not eligible/);

    const inv = (await db.query("select id from public.shift_invitations where shift_position_id = $1 and worker_id = $2", [s.position, f.workers.emp1])).rows[0].id;
    await asUser(db, f.users.workerEmp1, async (tx) => {
      const n = await tx.query("select title from public.notifications where entity_id = $1", [inv]);
      expect(n.rows[0].title).toBe("New shift offer");
    });
    const assignment = await asUserCommit(db, f.users.workerEmp1, (tx) => rpc(tx, "respond_to_shift_invitation", [inv, true, null]));

    // No wage rate yet → confirmation refused.
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.confirm_assignment($1)", [assignment]), "No wage or freelancer rate");
    });
    const contract = (await db.query("select id from public.employment_contracts where worker_id = $1 and status = 'active'", [f.workers.emp1])).rows[0].id;
    await db.query("insert into public.wage_rates (agency_id, worker_id, contract_id, hourly_gross, effective_from) values ($1, $2, $3, 15.25, '2029-01-01')", [f.agencyA, f.workers.emp1, contract]);

    await asUserCommit(db, f.users.opsA, (tx) => tx.query("select public.confirm_assignment($1)", [assignment]));
    const snap = (await db.query("select client_hourly_rate, worker_hourly_amount, worker_pay_basis, client_rate_rules from public.shift_rate_snapshots where assignment_id = $1", [assignment])).rows[0];
    expect(snap).toMatchObject({ client_hourly_rate: "32.5000", worker_hourly_amount: "15.2500", worker_pay_basis: "employee_wage" });
    expect(snap.client_rate_rules[0].kind).toBe("weekend");
    const elig = await db.query("select count(*)::int n from public.assignment_eligibility where assignment_id = $1", [assignment]);
    expect(elig.rows[0].n).toBe(1);
    expect((await db.query("select status from public.shift_assignments where id = $1", [assignment])).rows[0].status).toBe("confirmed");

    // Clients were notified, and see only the privacy-preserving projection.
    await asUser(db, f.users.client1Admin, async (tx) => {
      expect((await tx.query("select count(*)::int n from public.notifications where event_type = 'assignment.confirmed'")).rows[0].n).toBeGreaterThan(0);
      expect((await tx.query("select count(*)::int n from public.shift_rate_snapshots")).rows[0].n).toBe(0);
    });
  });

  it("refuses confirmation when no client rate card covers the shift", async () => {
    const s = await createShift(db, f, { ...window(), clientId: f.clients.c2, locationId: f.locations.c2Main });
    const a = await asUserCommit(db, f.users.opsA, (tx) => rpc(tx, "assign_worker", [s.position, f.workers.emp1, null]));
    await asUserCommit(db, f.users.workerEmp1, (tx) => tx.query("select public.respond_to_assignment($1, true)", [a]));
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.confirm_assignment($1)", [a]), "No active client rate card");
    });
  });
});

describe("replacement", () => {
  it("client requests a replacement; agency replaces the worker", async () => {
    const s = await createShift(db, f, window());
    await db.query(
      "insert into public.worker_certificates (agency_id, worker_id, certificate_id, status, expires_on) values ($1, $2, $3, 'verified', '2031-12-31')",
      [f.agencyA, f.workers.emp2, cert],
    );
    const contract = (await db.query("select id from public.employment_contracts where worker_id = $1 and status = 'active'", [f.workers.emp2])).rows[0].id;
    await db.query("insert into public.wage_rates (agency_id, worker_id, contract_id, hourly_gross, effective_from) values ($1, $2, $3, 14.80, '2029-01-01') on conflict do nothing", [f.agencyA, f.workers.emp2, contract]).catch(() => undefined);
    const a = await asUserCommit(db, f.users.opsA, (tx) => rpc(tx, "assign_worker", [s.position, f.workers.emp1, null]));
    await asUserCommit(db, f.users.workerEmp1, (tx) => tx.query("select public.respond_to_assignment($1, true)", [a]));
    await asUserCommit(db, f.users.opsA, (tx) => tx.query("select public.confirm_assignment($1)", [a]));

    await asUserCommit(db, f.users.client1Admin, (tx) => tx.query("select public.request_replacement($1, $2)", [a, "Worker was unwell last time"]));
    expect((await db.query("select status from public.shift_assignments where id = $1", [a])).rows[0].status).toBe("replacement_requested");
    await asUser(db, f.users.client2Admin, async (tx) => {
      await expectError(attempt(tx, "select public.request_replacement($1, 'nope nope')", [a]), "Not authorised");
    });

    const b = await asUserCommit(db, f.users.opsA, (tx) => rpc(tx, "replace_assignment", [a, f.workers.emp2, null]));
    const rows = (await db.query("select id, status, replaces_assignment_id from public.shift_assignments where shift_id = $1 order by created_at", [s.shift])).rows;
    expect(rows.find((r) => r.id === a).status).toBe("replaced");
    expect(rows.find((r) => r.id === b)).toMatchObject({ status: "invited", replaces_assignment_id: a });
  });
});

describe("shift creation and requests", () => {
  it("creates a weekly recurring series atomically", async () => {
    const ids = await asUserCommit(db, f.users.opsA, (tx) =>
      rpc(tx, "create_shifts", [JSON.stringify({
        client_id: f.clients.c1, location_id: f.locations.c1Main, title: "Night cleaning",
        starts_at: "2031-03-03T21:00:00Z", ends_at: "2031-03-04T05:00:00Z", break_minutes: 30,
        positions: [{ position_id: f.positions.cleanerA, headcount: 2, allowed_engagements: ["employee"] }],
        recurrence: { days: [1, 3, 5], until: "2031-03-16" },
      })]),
    );
    expect(ids).toHaveLength(6); // Mon/Wed/Fri over two weeks
    const rows = (await db.query("select recurrence_group_id, ends_at - starts_at as dur from public.shifts where id = any($1)", [ids])).rows;
    expect(new Set(rows.map((r) => r.recurrence_group_id)).size).toBe(1);
    expect((await db.query("select count(*)::int n from public.shift_positions where shift_id = any($1)", [ids])).rows[0].n).toBe(6);
  });

  it("rejects shifts for archived locations and invalid input without partial writes", async () => {
    await db.query("update public.client_locations set status = 'inactive' where id = $1", [f.locations.c1Second]);
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.create_shifts($1)", [JSON.stringify({
        client_id: f.clients.c1, location_id: f.locations.c1Second, title: "X", starts_at: "2031-04-01T08:00:00Z", ends_at: "2031-04-01T12:00:00Z",
        positions: [{ position_id: f.positions.cleanerA }],
      })]), "not active");
    });
    await db.query("update public.client_locations set status = 'active' where id = $1", [f.locations.c1Second]);
    await asUser(db, f.users.client1Admin, async (tx) => {
      await expectError(attempt(tx, "select public.create_shifts($1)", [JSON.stringify({ client_id: f.clients.c1 })]), "Not authorised");
    });
  });

  it("accepting a client request creates shifts and notifies the requester", async () => {
    const reqId = await asUserCommit(db, f.users.client1Admin, async (tx) =>
      (await tx.query(
        `insert into public.shift_requests (agency_id, client_id, location_id, position_id, requested_by, status, headcount, starts_at, ends_at, break_minutes, is_urgent)
         values ($1, $2, $3, $4, $5, 'submitted', 5, '2031-05-05T07:00:00Z', '2031-05-05T15:00:00Z', 30, true) returning id`,
        [f.agencyA, f.clients.c1, f.locations.c1Main, f.positions.cleanerA, f.users.client1Admin],
      )).rows[0].id,
    );
    await asUser(db, f.users.opsA, async (tx) => {
      const n = await tx.query("select title from public.notifications where entity_id = $1", [reqId]);
      expect(n.rows[0].title).toBe("URGENT staffing request");
    });
    const ids = await asUserCommit(db, f.users.opsA, (tx) => rpc(tx, "accept_shift_request", [reqId, null]));
    expect(ids).toHaveLength(1);
    const pos = (await db.query("select headcount, allowed_engagements from public.shift_positions where shift_id = $1", [ids[0]])).rows[0];
    expect(pos.headcount).toBe(5);
    expect((await db.query("select status from public.shift_requests where id = $1", [reqId])).rows[0].status).toBe("accepted");
    await asUser(db, f.users.client1Admin, async (tx) => {
      expect((await tx.query("select count(*)::int n from public.notifications where entity_id = $1 and event_type = 'request.accepted'", [reqId])).rows[0].n).toBe(1);
      expect((await tx.query("select count(*)::int n from public.shifts where id = $1", [ids[0]])).rows[0].n).toBe(1);
    });
  });
});
