#!/usr/bin/env node
/**
 * Demo / preview data for a NON-PRODUCTION ShiftPilot environment.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/seed-demo.mjs [--password 'at-least-12-chars']
 *
 * Creates the agency "Demo Uitzendbureau" (slug `demo`) with staff, two clients,
 * workers on both pathways, past/current/upcoming shifts, timesheets in every
 * approval state, an issued invoice and an open staffing request. All people
 * and companies are fictitious and use example.com addresses.
 *
 * Refuses to run when NEXT_PUBLIC_APP_ENV=production. Idempotent: exits if the
 * demo agency already exists. Also used by the signed-in E2E CI job.
 */
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values: args } = parseArgs({ options: { password: { type: "string" } } });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = args.password ?? process.env.DEMO_PASSWORD ?? "ShiftPilot-demo-2026!";

if (process.env.NEXT_PUBLIC_APP_ENV === "production") throw new Error("seed-demo refuses to run in production.");
if (!url || !anonKey || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.");
if (password.length < 12) throw new Error("The demo password must be at least 12 characters.");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const TZ = "Europe/Amsterdam";

/** Throws with context on any Supabase error. */
function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** UTC ISO string for a local Amsterdam date (offset in days from today) and HH:MM. */
function at(dayOffset, hhmm) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const date = d.toISOString().slice(0, 10);
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  const utc = new Date(guess.getTime() - (local.getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime()));
  return utc.toISOString();
}
const localDate = (dayOffset) => at(dayOffset, "12:00").slice(0, 10);

async function ensureUser(email, fullName) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (!created.error) return created.data.user.id;
  const list = must(await admin.auth.admin.listUsers({ perPage: 1000 }), "list users");
  const found = list.users.find((u) => u.email === email);
  if (!found) throw new Error(`create user ${email}: ${created.error.message}`);
  return found.id;
}

async function signedIn(email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await c.auth.signInWithPassword({ email, password }), `sign in ${email}`);
  return c;
}

const existing = must(await admin.from("agencies").select("id").eq("slug", "demo").maybeSingle(), "check agency");
if (existing) {
  console.log("Demo agency already exists; nothing to do.");
  process.exit(0);
}

// --- People -----------------------------------------------------------------
const U = {
  owner: ["eigenaar@example.com", "Eva de Eigenaar"],
  planner: ["planner@example.com", "Pieter Planner"],
  finance: ["financien@example.com", "Fatima Financiën"],
  client: ["klant@example.com", "Karin Klant"],
  worker: ["medewerker@example.com", "Mohamed Medewerker"],
  freelancer: ["zzp@example.com", "Zoë Zelfstandige"],
};
const ids = {};
for (const [k, [email, name]] of Object.entries(U)) ids[k] = await ensureUser(email, name);

// --- Agency -----------------------------------------------------------------
const agency = must(await admin.rpc("bootstrap_agency", { p_name: "Demo Uitzendbureau", p_slug: "demo", p_owner_user_id: ids.owner }), "bootstrap agency");
must(await admin.from("agencies").update({ legal_name: "Demo Uitzendbureau B.V.", kvk_number: "12345678", vat_number: "NL000099998B57" }).eq("id", agency), "agency details");
must(await admin.from("agency_settings").update({ contact_email: "planning@example.com", contact_phone: "+31 30 123 4567", address_line1: "Oudegracht 1", postal_code: "3511 AA", city: "Utrecht", iban: "NL91ABNA0417164300" }).eq("agency_id", agency), "agency settings");
const roles = must(await admin.from("roles").select("id, key").is("agency_id", null), "roles");
const role = (key) => roles.find((r) => r.key === key).id;
must(await admin.from("user_roles").insert([
  { agency_id: agency, user_id: ids.planner, role_id: role("operations_manager") },
  { agency_id: agency, user_id: ids.finance, role_id: role("finance") },
]), "staff roles");

// --- Configuration ----------------------------------------------------------
const industries = must(await admin.from("industries").select("id, slug").eq("agency_id", agency), "industries");
const ind = (slug) => industries.find((i) => i.slug === slug).id;
const positions = must(await admin.from("job_positions").insert([
  { agency_id: agency, industry_id: ind("cleaning"), name: "Schoonmaker", allows_freelancers: true },
  { agency_id: agency, industry_id: ind("hospitality"), name: "Bediening", allows_freelancers: true },
  { agency_id: agency, industry_id: ind("logistics"), name: "Magazijnmedewerker", allows_freelancers: false },
]).select("id, name"), "positions");
const pos = (name) => positions.find((p) => p.name === name).id;

// --- Clients ----------------------------------------------------------------
const clients = must(await admin.from("clients").insert([
  { agency_id: agency, name: "Hotel Domstad", legal_name: "Hotel Domstad B.V.", status: "active", billing_email: "administratie@example.com", billing_postal_code: "3512 JE", billing_city: "Utrecht", payment_term_days: 14 },
  { agency_id: agency, name: "Logistiek Centrum Nieuwegein", status: "active", billing_email: "crediteuren@example.com", billing_city: "Nieuwegein", payment_term_days: 30 },
]).select("id, name"), "clients");
const hotel = clients[0].id;
const dc = clients[1].id;
const locations = must(await admin.from("client_locations").insert([
  { agency_id: agency, client_id: hotel, name: "Hotel Domstad — Centrum", address_line1: "Domplein 9", postal_code: "3512 JE", city: "Utrecht", latitude: 52.090736, longitude: 5.121420, geofence_radius_m: 150, arrival_instructions: "Meld je bij de receptie en vraag naar de housekeeping-manager." },
  { agency_id: agency, client_id: dc, name: "DC Nieuwegein", address_line1: "Edisonbaan 14", postal_code: "3439 MN", city: "Nieuwegein", latitude: 52.034290, longitude: 5.092110, parking_info: "Parkeren op P2 achter het gebouw." },
]).select("id, client_id"), "locations");
const hotelLoc = locations[0].id;
const dcLoc = locations[1].id;
must(await admin.from("client_memberships").insert({ agency_id: agency, client_id: hotel, user_id: ids.client, role: "client_admin", can_request_staff: true, can_approve_timesheets: true, can_view_finance: true, can_manage_users: true }), "client membership");

const card = must(await admin.from("client_rate_cards").insert([
  { agency_id: agency, client_id: hotel, name: "Tarieven 2026", status: "draft", effective_from: localDate(-90), created_by: ids.owner },
  { agency_id: agency, client_id: dc, name: "Tarieven 2026", status: "draft", effective_from: localDate(-90), created_by: ids.owner },
]).select("id, client_id"), "rate cards");
must(await admin.from("client_rate_rules").insert([
  { agency_id: agency, rate_card_id: card[0].id, position_id: pos("Schoonmaker"), rule_kind: "base", hourly_rate: 32.5 },
  { agency_id: agency, rate_card_id: card[0].id, position_id: pos("Bediening"), rule_kind: "base", hourly_rate: 34 },
  { agency_id: agency, rate_card_id: card[0].id, rule_kind: "weekend", multiplier: 1.5, days_of_week: [6, 7] },
  { agency_id: agency, rate_card_id: card[1].id, position_id: pos("Magazijnmedewerker"), rule_kind: "base", hourly_rate: 29.75 },
  { agency_id: agency, rate_card_id: card[1].id, rule_kind: "night", hourly_rate: 37.2, time_from: "22:00", time_to: "06:00" },
]), "rate rules");
for (const c of card) must(await admin.from("client_rate_cards").update({ status: "active", approved_by: ids.owner, approved_at: new Date().toISOString() }).eq("id", c.id), "activate rate card");

// --- Workers ----------------------------------------------------------------
async function worker(first, last, email, type, userId, city, lat, lon) {
  const w = must(await admin.from("workers").insert({ agency_id: agency, user_id: userId, engagement_type: type, first_name: first, last_name: last, email, phone: "+31 6 1234 5678", city, home_latitude: lat, home_longitude: lon, max_travel_km: 30 }).select("id").single(), `worker ${first}`);
  must(await admin.from("worker_private_details").update({ identity_verification_status: "verified", identity_verified_at: new Date().toISOString(), work_eligibility_status: "verified", work_eligibility_verified_at: new Date().toISOString() }).eq("worker_id", w.id), "verify worker");
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  if (type === "employee") {
    const c = must(await admin.from("employment_contracts").insert({ agency_id: agency, worker_id: w.id, contract_number: `AC-${ref}`, contract_kind: "fase_a", status: "active", start_date: localDate(-120), signature_method: "external_esign", signed_at: new Date().toISOString() }).select("id").single(), "contract");
    must(await admin.from("wage_rates").insert({ agency_id: agency, worker_id: w.id, contract_id: c.id, hourly_gross: 15.5, effective_from: localDate(-120), reason: "Demo" }), "wage");
  } else {
    const b = must(await admin.from("freelancer_businesses").insert({ agency_id: agency, worker_id: w.id, trade_name: `${first} ${last} Services`, kvk_number: "87654321", classification_status: "approved", classification_reviewed_at: new Date().toISOString() }).select("id").single(), "business");
    must(await admin.from("freelancer_agreements").insert({ agency_id: agency, business_id: b.id, agreement_number: `ZA-${ref}`, status: "active", start_date: localDate(-120), service_description: "Bediening en schoonmaak op afroep", signed_at: new Date().toISOString() }), "agreement");
  }
  must(await admin.from("workers").update({ status: "active" }).eq("id", w.id), "activate worker");
  return { id: w.id, type };
}
const W = {
  mohamed: await worker("Mohamed", "Medewerker", U.worker[0], "employee", ids.worker, "Utrecht", 52.0907, 5.1214),
  zoe: await worker("Zoë", "Zelfstandige", U.freelancer[0], "freelancer", ids.freelancer, "Zeist", 52.0894, 5.2333),
  sanne: await worker("Sanne", "Jansen", "sanne.jansen@example.com", "employee", null, "Houten", 52.0284, 5.1683),
  daan: await worker("Daan", "Bakker", "daan.bakker@example.com", "employee", null, "Nieuwegein", 52.0292, 5.0819),
};

// --- Shifts -----------------------------------------------------------------
async function shift(o) {
  const s = must(await admin.from("shifts").insert({ agency_id: agency, client_id: o.client, location_id: o.loc, title: o.title, starts_at: at(o.day, o.from), ends_at: at(o.day + (o.to < o.from ? 1 : 0), o.to), break_minutes: o.brk ?? 30, status: "open", instructions: o.instructions ?? null }).select("id, starts_at, ends_at").single(), `shift ${o.title}`);
  const p = must(await admin.from("shift_positions").insert({ agency_id: agency, shift_id: s.id, position_id: o.position, headcount: o.headcount ?? 1, allowed_engagements: o.engagements ?? ["employee", "freelancer"] }).select("id").single(), "shift position");
  return { ...s, position: p.id, client: o.client, loc: o.loc, rate: o.rate };
}
async function assign(s, w) {
  const a = must(await admin.from("shift_assignments").insert({ agency_id: agency, shift_id: s.id, shift_position_id: s.position, worker_id: w.id, status: "confirmed", starts_at: s.starts_at, ends_at: s.ends_at }).select("id").single(), "assignment");
  must(await admin.from("shift_rate_snapshots").insert({ agency_id: agency, assignment_id: a.id, client_hourly_rate: s.rate, client_rate_rules: [{ kind: "weekend", multiplier: 1.5, days_of_week: [6, 7] }], worker_pay_basis: w.type === "employee" ? "employee_wage" : "freelancer_rate", worker_hourly_amount: w.type === "employee" ? 15.5 : 27.5, employer_cost_percentage: w.type === "employee" ? 32 : null }), "rate snapshot");
  return a.id;
}
async function timesheet(s, w, assignment, status, lateMin = 0) {
  const start = new Date(new Date(s.starts_at).getTime() + lateMin * 60000).toISOString();
  const worked = Math.round((new Date(s.ends_at) - new Date(start)) / 60000) - 30;
  const ts = must(await admin.from("timesheets").insert({ agency_id: agency, assignment_id: assignment, shift_id: s.id, worker_id: w.id, client_id: s.client, location_id: s.loc, scheduled_start: s.starts_at, scheduled_end: s.ends_at, scheduled_break_minutes: 30, actual_start: start, actual_end: s.ends_at, break_minutes: 30, worked_minutes: worked, late_minutes: lateMin, overtime_minutes: 0, status: "draft" }).select("id").single(), "timesheet");
  const steps = { submitted: ["submitted"], client_approved: ["submitted", "client_approved"], agency_approved: ["submitted", "client_approved", "agency_approved"], disputed: ["submitted", "disputed"] }[status];
  for (const st of steps) {
    const patch = { status: st, ...(st === "submitted" ? { submitted_at: new Date().toISOString() } : {}), ...(st === "client_approved" ? { client_approved_at: new Date().toISOString() } : {}), ...(st === "agency_approved" ? { agency_approved_at: new Date().toISOString() } : {}) };
    must(await admin.from("timesheets").update(patch).eq("id", ts.id), `timesheet ${st}`);
  }
  return ts.id;
}

const past = [
  { day: -6, client: hotel, loc: hotelLoc, title: "Housekeeping ochtend", position: pos("Schoonmaker"), from: "07:00", to: "15:00", rate: 32.5, w: W.mohamed, status: "agency_approved" },
  { day: -5, client: hotel, loc: hotelLoc, title: "Ontbijtservice", position: pos("Bediening"), from: "06:30", to: "11:30", rate: 34, w: W.zoe, status: "agency_approved" },
  { day: -4, client: dc, loc: dcLoc, title: "Orderpicken avond", position: pos("Magazijnmedewerker"), from: "15:00", to: "23:00", rate: 29.75, w: W.daan, status: "agency_approved" },
  { day: -3, client: hotel, loc: hotelLoc, title: "Housekeeping ochtend", position: pos("Schoonmaker"), from: "07:00", to: "15:00", rate: 32.5, w: W.sanne, status: "client_approved", late: 12 },
  { day: -2, client: hotel, loc: hotelLoc, title: "Diner bediening", position: pos("Bediening"), from: "16:00", to: "23:00", rate: 34, w: W.zoe, status: "submitted" },
  { day: -1, client: hotel, loc: hotelLoc, title: "Housekeeping ochtend", position: pos("Schoonmaker"), from: "07:00", to: "15:00", rate: 32.5, w: W.mohamed, status: "disputed", late: 25 },
  { day: -1, client: dc, loc: dcLoc, title: "Inbound lossen", position: pos("Magazijnmedewerker"), from: "06:00", to: "14:30", rate: 29.75, w: W.daan, status: "submitted" },
];
for (const p of past) {
  const s = await shift({ ...p, engagements: p.position === pos("Magazijnmedewerker") ? ["employee"] : undefined });
  const a = await assign(s, p.w);
  await timesheet(s, p.w, a, p.status, p.late ?? 0);
}

// Today: one shift running (checked in by the planner as a staff entry), one later today, one missing check-in.
const nowHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
const running = await shift({ day: 0, client: hotel, loc: hotelLoc, title: "Housekeeping dagdienst", position: pos("Schoonmaker"), from: hh(nowHour - 2), to: hh(nowHour + 5), rate: 32.5, headcount: 2 });
const runningA = await assign(running, W.mohamed);
const missing = await shift({ day: 0, client: dc, loc: dcLoc, title: "Retourverwerking", position: pos("Magazijnmedewerker"), from: hh(nowHour - 1), to: hh(nowHour + 6), rate: 29.75, engagements: ["employee"] });
await assign(missing, W.daan);
const later = await shift({ day: 0, client: hotel, loc: hotelLoc, title: "Banqueting avond", position: pos("Bediening"), from: hh(nowHour + 3), to: hh(nowHour + 8), rate: 34, headcount: 3 });
await assign(later, W.zoe);

// Upcoming week: a mix of filled and open shifts.
const upcoming = [
  { day: 1, client: hotel, loc: hotelLoc, title: "Housekeeping ochtend", position: pos("Schoonmaker"), from: "07:00", to: "15:00", rate: 32.5, headcount: 3, fill: [W.mohamed, W.sanne] },
  { day: 1, client: dc, loc: dcLoc, title: "Nachtploeg orderpicken", position: pos("Magazijnmedewerker"), from: "22:00", to: "06:00", rate: 29.75, headcount: 4, engagements: ["employee"], fill: [W.daan] },
  { day: 2, client: hotel, loc: hotelLoc, title: "Ontbijtservice", position: pos("Bediening"), from: "06:30", to: "11:30", rate: 34, headcount: 2, fill: [W.zoe] },
  { day: 3, client: hotel, loc: hotelLoc, title: "Congres bediening", position: pos("Bediening"), from: "08:00", to: "17:00", rate: 34, headcount: 6, fill: [] },
  { day: 5, client: hotel, loc: hotelLoc, title: "Weekend housekeeping", position: pos("Schoonmaker"), from: "08:00", to: "16:00", rate: 32.5, headcount: 2, fill: [W.sanne] },
  { day: 6, client: dc, loc: dcLoc, title: "Inbound lossen", position: pos("Magazijnmedewerker"), from: "06:00", to: "14:30", rate: 29.75, headcount: 3, engagements: ["employee"], fill: [] },
];
for (const u of upcoming) {
  const s = await shift(u);
  for (const w of u.fill) await assign(s, w);
}

// Open staffing request from the hotel.
must(await admin.from("shift_requests").insert({ agency_id: agency, client_id: hotel, location_id: hotelLoc, position_id: pos("Bediening"), requested_by: ids.client, status: "submitted", headcount: 4, starts_at: at(8, "17:00"), ends_at: at(8, "23:30"), break_minutes: 30, instructions: "Bruiloft, zwarte kleding verplicht.", is_urgent: false }), "staffing request");

// --- Actions as real users (exercises RPCs and RLS) -------------------------
const planner = await signedIn(U.planner[0]);
must(await planner.rpc("staff_record_attendance", { p_assignment_id: runningA, p_event_type: "check_in", p_occurred_at: new Date(new Date(running.starts_at).getTime() + 4 * 60000).toISOString(), p_note: "Ingevoerd door planner (demo)" }), "staff check-in");

const finance = await signedIn(U.finance[0]);
const invoiceId = must(await finance.rpc("generate_client_invoice", { p_client_id: hotel, p_period_start: localDate(-14), p_period_end: localDate(0) }), "generate invoice");
const number = must(await finance.rpc("issue_invoice", { p_invoice_id: invoiceId }), "issue invoice");

console.log(`\nDemo agency seeded (invoice ${number}).\nPassword for every account: ${password}\n`);
for (const [k, [email]] of Object.entries(U)) console.log(`  ${k.padEnd(10)} ${email}`);
console.log("\nThese accounts are for non-production preview only.");
