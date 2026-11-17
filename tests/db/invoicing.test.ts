/**
 * Financial engine: billing classification from rate snapshots, invoice
 * generation/issuing/locking, credit notes, payroll export, freelancer
 * purchase invoices and the financial summary.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateWorker, asUser, asUserCommit, attempt, buildFixture, createPool, createShift, createUser, expectError, type Fixture } from "./helpers";

const db = createPool();
let f: Fixture;

const RULES = [
  { kind: "weekend", multiplier: 1.5, days_of_week: [6, 7] },
  { kind: "night", hourly_rate: 40, time_from: "22:00:00", time_to: "06:00:00" },
  { kind: "public_holiday", multiplier: 2 },
  { kind: "overtime", multiplier: 1.25 },
];

beforeAll(async () => {
  f = await buildFixture(db);
  await db.query("insert into public.public_holidays (agency_id, holiday_date, name) values ($1, '2031-04-27', 'Koningsdag')", [f.agencyA]);
});
afterAll(async () => {
  await db.end();
});

async function newWorker(type: "employee" | "freelancer" = "employee") {
  const user = await createUser(db, "finWorker");
  const id = (await db.query(
    "insert into public.workers (agency_id, user_id, engagement_type, first_name, last_name, email) values ($1, $2, $3, 'Fin', 'Worker', $4) returning id",
    [f.agencyA, user, type, `fin-${user.slice(0, 8)}@example.test`],
  )).rows[0].id as string;
  await activateWorker(db, f.agencyA, id, type);
  return { id, user };
}

/** An agency-approved timesheet with a snapshot (client base €30). Times are UTC. */
async function approvedTimesheet(o: { worker: string; type: "employee" | "freelancer"; schedStart: string; schedEnd: string; actStart?: string; actEnd?: string; brk?: number; clientId?: string; locationId?: string; workerRate?: number }) {
  const s = await createShift(db, f, { start: o.schedStart, end: o.schedEnd, clientId: o.clientId, locationId: o.locationId, headcount: 5 });
  const a = (await db.query(
    "insert into public.shift_assignments (agency_id, shift_id, shift_position_id, worker_id, status, starts_at, ends_at) values ($1, $2, $3, $4, 'confirmed', now(), now()) returning id",
    [f.agencyA, s.shift, s.position, o.worker],
  )).rows[0].id;
  await db.query(
    `insert into public.shift_rate_snapshots (agency_id, assignment_id, client_hourly_rate, client_rate_rules, worker_pay_basis, worker_hourly_amount, employer_cost_percentage)
     values ($1, $2, 30, $3, $4, $5, $6)`,
    [f.agencyA, a, JSON.stringify(RULES), o.type === "employee" ? "employee_wage" : "freelancer_rate", o.workerRate ?? (o.type === "employee" ? 15 : 25), o.type === "employee" ? 30 : null],
  );
  const brk = o.brk ?? 30;
  const ts = (await db.query(
    `insert into public.timesheets (agency_id, assignment_id, shift_id, worker_id, client_id, location_id, scheduled_start, scheduled_end, scheduled_break_minutes, actual_start, actual_end, break_minutes, worked_minutes, overtime_minutes, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 30, $9, $10, $11,
             (extract(epoch from ($10::timestamptz - $9::timestamptz)) / 60)::int - $11,
             greatest(0, (extract(epoch from ($10::timestamptz - $9::timestamptz)) / 60)::int - $11 - ((extract(epoch from ($8::timestamptz - $7::timestamptz)) / 60)::int - 30)),
             'draft') returning id`,
    [f.agencyA, a, s.shift, o.worker, o.clientId ?? f.clients.c1, o.locationId ?? f.locations.c1Main, o.schedStart, o.schedEnd, o.actStart ?? o.schedStart, o.actEnd ?? o.schedEnd, brk],
  )).rows[0].id as string;
  await db.query("update public.timesheets set status = 'submitted', submitted_at = now() where id = $1", [ts]);
  await db.query("update public.timesheets set status = 'client_approved', client_approved_at = now() where id = $1", [ts]);
  await db.query("update public.timesheets set status = 'agency_approved', agency_approved_at = now() where id = $1", [ts]);
  return ts;
}

const breakdown = async (ts: string) =>
  asUser(db, f.users.financeA, async (tx) =>
    Object.fromEntries((await tx.query("select category, minutes, hourly_rate::float r from public.timesheet_billing_preview($1)", [ts])).rows.map((r) => [r.category, [r.minutes, r.r]])),
  );

describe("billing classification", () => {
  it("bills weekend minutes at the weekend multiplier", async () => {
    const w = await newWorker();
    // Saturday 4 Jan 2031, 10:00–14:00 Amsterdam (UTC+1)
    const ts = await approvedTimesheet({ worker: w.id, type: "employee", schedStart: "2031-01-04T09:00:00Z", schedEnd: "2031-01-04T13:00:00Z" });
    expect(await breakdown(ts)).toEqual({ weekend: [210, 45] });
  });

  it("splits night minutes, deducts the break from regular time and adds an overtime surcharge", async () => {
    const w = await newWorker();
    // Monday 6 Jan 2031: scheduled 18:00–23:00, worked 18:00–24:00 local
    const ts = await approvedTimesheet({ worker: w.id, type: "employee", schedStart: "2031-01-06T17:00:00Z", schedEnd: "2031-01-06T22:00:00Z", actEnd: "2031-01-06T23:00:00Z" });
    expect(await breakdown(ts)).toEqual({ regular: [210, 30], night: [120, 40], overtime_surcharge: [60, 7.5] });
  });

  it("bills configured public holidays at the holiday rate", async () => {
    const w = await newWorker();
    // Sunday 27 Apr 2031 is configured as a holiday (holiday wins over weekend); summer time UTC+2
    const ts = await approvedTimesheet({ worker: w.id, type: "employee", schedStart: "2031-04-27T08:00:00Z", schedEnd: "2031-04-27T12:00:00Z" });
    expect(await breakdown(ts)).toEqual({ public_holiday: [210, 60] });
  });
});

describe("client invoicing", () => {
  it("generates, issues with a number and billing snapshot, and locks the timesheets", async () => {
    const w = await newWorker();
    const ts1 = await approvedTimesheet({ worker: w.id, type: "employee", schedStart: "2031-02-03T07:00:00Z", schedEnd: "2031-02-03T15:00:00Z", clientId: f.clients.c2, locationId: f.locations.c2Main });
    const inv = await asUserCommit(db, f.users.invoiceDrafterA, async (tx) => (await tx.query("select public.generate_client_invoice($1, '2031-02-01', '2031-02-28') id", [f.clients.c2])).rows[0].id);
    const draft = (await db.query("select status, subtotal, vat_total, total from public.invoices where id = $1", [inv])).rows[0];
    // 7.5 h regular × €30 = €225; 21% VAT = €47.25
    expect(draft).toEqual({ status: "draft", subtotal: "225.00", vat_total: "47.25", total: "272.25" });

    await asUser(db, f.users.invoiceDrafterA, async (tx) => {
      await expectError(attempt(tx, "select public.issue_invoice($1)", [inv]), "Not authorised");
    });
    const number = await asUserCommit(db, f.users.financeA, async (tx) => (await tx.query("select public.issue_invoice($1) n", [inv])).rows[0].n);
    expect(number).toMatch(/^INV-\d{4}-\d{5}$/);
    const issued = (await db.query("select status, billing_snapshot, due_date - issue_date as terms from public.invoices where id = $1", [inv])).rows[0];
    expect(issued.status).toBe("issued");
    expect(issued.billing_snapshot.client.name).toBe("Client Two");
    expect(issued.terms).toBe(14);
    expect((await db.query("select status, locked_reason from public.timesheets where id = $1", [ts1])).rows[0]).toEqual({ status: "locked", locked_reason: "invoiced" });

    // Already invoiced: nothing left to bill.
    await asUser(db, f.users.financeA, async (tx) => {
      await expectError(attempt(tx, "select public.generate_client_invoice($1, '2031-02-01', '2031-02-28')", [f.clients.c2]), "No approved, uninvoiced timesheets");
    });
    // The client sees it and was notified.
    await asUser(db, f.users.client2Admin, async (tx) => {
      expect((await tx.query("select count(*)::int n from public.invoices where id = $1", [inv])).rows[0].n).toBe(1);
      expect((await tx.query("select count(*)::int n from public.notifications where entity_id = $1", [inv])).rows[0].n).toBe(1);
    });

    // Credit note mirrors the invoice with negative amounts and marks it credited.
    const cn = await asUserCommit(db, f.users.financeA, async (tx) => (await tx.query("select public.create_credit_note($1, 'Rate agreed lower') id", [inv])).rows[0].id);
    const credit = (await db.query("select kind, status, total, invoice_number from public.invoices where id = $1", [cn])).rows[0];
    expect(credit).toMatchObject({ kind: "credit_note", status: "issued", total: "-272.25" });
    expect(credit.invoice_number).toMatch(/^INV-CN-\d{4}-\d{5}$/);
    expect((await db.query("select status from public.invoices where id = $1", [inv])).rows[0].status).toBe("credited");
    await asUser(db, f.users.financeA, async (tx) => {
      await expectError(attempt(tx, "select public.create_credit_note($1, 'again')", [inv]), /Only issued invoices|already been credited/);
    });
  });
});

describe("payroll export", () => {
  it("exports employee hours by category and supersedes earlier exports", async () => {
    const w = await newWorker();
    await approvedTimesheet({ worker: w.id, type: "employee", schedStart: "2031-03-08T09:00:00Z", schedEnd: "2031-03-08T13:00:00Z" }); // Saturday
    const period = (await db.query("insert into public.payroll_periods (agency_id, frequency, name, period_start, period_end) values ($1, 'monthly', 'March 2031', '2031-03-01', '2031-03-31') returning id", [f.agencyA])).rows[0].id;
    const first = await asUserCommit(db, f.users.financeA, async (tx) => (await tx.query("select public.generate_payroll_export($1) id", [period])).rows[0].id);
    const line = (await db.query("select minutes_by_kind, hourly_gross from public.payroll_export_lines where payroll_export_id = $1 and worker_id = $2", [first, w.id])).rows[0];
    expect(line.minutes_by_kind).toMatchObject({ total: 210, weekend: 210, regular: 0, night: 0 });
    expect(line.hourly_gross).toBe("15.0000");
    const second = await asUserCommit(db, f.users.financeA, async (tx) => (await tx.query("select public.generate_payroll_export($1) id", [period])).rows[0].id);
    expect((await db.query("select status from public.payroll_exports where id = $1", [first])).rows[0].status).toBe("superseded");
    expect(second).not.toBe(first);
    await asUser(db, f.users.opsA, async (tx) => {
      await expectError(attempt(tx, "select public.generate_payroll_export($1)", [period]), "Not authorised");
    });
  });
});

describe("freelancer purchase invoices", () => {
  it("lets a freelancer invoice their own approved hours once; agency reviews and pays", async () => {
    const fr = await newWorker("freelancer");
    const other = await newWorker("freelancer");
    const ts = await approvedTimesheet({ worker: fr.id, type: "freelancer", schedStart: "2031-05-05T07:00:00Z", schedEnd: "2031-05-05T11:00:00Z", workerRate: 25 });
    const list = await asUser(db, fr.user, async (tx) => (await tx.query("select * from public.my_uninvoiced_timesheets($1)", [fr.id])).rows);
    expect(list.map((r) => r.amount)).toEqual(["87.50"]); // 3.5 h × €25
    await asUser(db, other.user, async (tx) => {
      await expectError(attempt(tx, "select public.submit_freelancer_invoice($1, 'X-1', current_date, $2, 21, 'NL91ABNA0417164300', 'Other')", [other.id, [ts]]), /own and approved|not found/);
    });
    const fi = await asUserCommit(db, fr.user, async (tx) =>
      (await tx.query("select public.submit_freelancer_invoice($1, 'F-2031-01', current_date, $2, 21, 'NL91 ABNA 0417 1643 00', 'Fin Worker') id", [fr.id, [ts]])).rows[0].id,
    );
    const row = (await db.query("select status, subtotal, vat_amount, total, payee_iban from public.freelancer_invoices where id = $1", [fi])).rows[0];
    expect(row).toEqual({ status: "submitted", subtotal: "87.50", vat_amount: "18.38", total: "105.88", payee_iban: "NL91ABNA0417164300" });
    await asUser(db, fr.user, async (tx) => {
      await expectError(attempt(tx, "select public.submit_freelancer_invoice($1, 'F-2031-02', current_date, $2, 21, 'NL91ABNA0417164300', 'Fin')", [fr.id, [ts]]), "already been invoiced");
      await expectError(attempt(tx, "select public.review_freelancer_invoice($1, true, 'self')", [fi]), "Not authorised");
    });
    await asUserCommit(db, f.users.financeA, (tx) => tx.query("select public.review_freelancer_invoice($1, true, null)", [fi]));
    await asUserCommit(db, f.users.financeA, (tx) => tx.query("select public.mark_freelancer_invoice_paid($1, current_date, 'BANK-123')", [fi]));
    expect((await db.query("select status from public.freelancer_invoices where id = $1", [fi])).rows[0].status).toBe("paid");
  });

  it("employees cannot submit purchase invoices", async () => {
    const w = await newWorker();
    await asUser(db, w.user, async (tx) => {
      await expectError(attempt(tx, "select public.submit_freelancer_invoice($1, 'E-1', current_date, '{}'::uuid[], 21, 'NL91ABNA0417164300', 'E')", [w.id]), "Only freelancers");
    });
  });
});

describe("financial summary", () => {
  it("reports revenue, direct costs and an estimated margin for finance users only", async () => {
    const s = await asUser(db, f.users.financeA, async (tx) => (await tx.query("select public.financial_summary($1, '2026-01-01', '2031-12-31') s", [f.agencyA])).rows[0].s);
    expect(Number(s.revenue)).toBeGreaterThan(0);
    expect(Number(s.credit_notes)).toBeGreaterThan(0);
    expect(Number(s.direct_cost_estimate)).toBeGreaterThan(0);
    expect(s.note).toContain("not net profit");
    expect(Array.isArray(s.by_client)).toBe(true);
    await asUser(db, f.users.recruiterA, async (tx) => {
      await expectError(attempt(tx, "select public.financial_summary($1, '2031-01-01', '2031-12-31')", [f.agencyA]), "Not authorised");
    });
  });
});
