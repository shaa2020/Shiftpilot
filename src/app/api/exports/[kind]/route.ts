import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/finance/csv";
import { addDays, localDate, zonedMidnight } from "@/lib/time";

const TZ = "Europe/Amsterdam";
const fmt = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "";
const hours = (min: number | null | undefined) => (min == null ? "" : (min / 60).toFixed(2));
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * CSV exports of workers, shifts and timesheets for spreadsheets. Runs as the
 * signed-in staff member, so row-level security limits what is exported.
 * Bank details and identity numbers are never included.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const perm = ({ workers: "workers.read", shifts: "shifts.read", timesheets: "timesheets.read" } as const)[kind as "workers"];
  if (!perm) return new NextResponse("Not found", { status: 404 });
  const ctx = await requireStaff(perm);
  const supabase = await createClient();
  const sp = request.nextUrl.searchParams;
  const today = localDate(new Date(), TZ);
  const from = dateParam.safeParse(sp.get("from")).data ?? addDays(today, -31);
  const to = dateParam.safeParse(sp.get("to")).data ?? addDays(today, 31);
  const start = zonedMidnight(from, TZ).toISOString();
  const end = zonedMidnight(addDays(to, 1), TZ).toISOString();

  let csv: string;
  if (kind === "workers") {
    const { data, error } = await supabase
      .from("workers")
      .select("worker_number, first_name, last_name, email, phone, engagement_type, status, city, postal_code, activated_at, created_at")
      .eq("agency_id", ctx.agencyId)
      .order("worker_number")
      .limit(20000);
    if (error) return new NextResponse("Export failed", { status: 500 });
    csv = toCsv(
      ["Worker number", "First name", "Last name", "Email", "Phone", "Engagement", "Status", "City", "Postal code", "Activated", "Created"],
      (data ?? []).map((w) => [w.worker_number, w.first_name, w.last_name, w.email, w.phone, w.engagement_type, w.status, w.city, w.postal_code, fmt(w.activated_at), fmt(w.created_at)]),
    );
  } else if (kind === "shifts") {
    const { data, error } = await supabase
      .from("shifts")
      .select("title, starts_at, ends_at, break_minutes, status, clients(name), client_locations(name, city), shift_positions(headcount, filled_count, job_positions(name))")
      .eq("agency_id", ctx.agencyId)
      .gte("starts_at", start)
      .lt("starts_at", end)
      .order("starts_at")
      .limit(20000);
    if (error) return new NextResponse("Export failed", { status: 500 });
    csv = toCsv(
      ["Start", "End", "Break (min)", "Title", "Client", "Location", "City", "Positions", "Headcount", "Filled", "Status"],
      (data ?? []).map((s) => [
        fmt(s.starts_at), fmt(s.ends_at), s.break_minutes, s.title, s.clients?.name, s.client_locations?.name, s.client_locations?.city,
        s.shift_positions.map((p) => p.job_positions?.name).filter(Boolean).join(" / "),
        s.shift_positions.reduce((n, p) => n + p.headcount, 0),
        s.shift_positions.reduce((n, p) => n + p.filled_count, 0),
        s.status,
      ]),
    );
  } else {
    const { data, error } = await supabase
      .from("timesheets")
      .select("scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, worked_minutes, overtime_minutes, late_minutes, status, client_approved_at, agency_approved_at, workers(worker_number, first_name, last_name), clients(name), client_locations(name)")
      .eq("agency_id", ctx.agencyId)
      .gte("scheduled_start", start)
      .lt("scheduled_start", end)
      .order("scheduled_start")
      .limit(20000);
    if (error) return new NextResponse("Export failed", { status: 500 });
    csv = toCsv(
      ["Worker number", "Worker", "Client", "Location", "Scheduled start", "Scheduled end", "Actual start", "Actual end", "Break (min)", "Worked (h)", "Overtime (h)", "Late (min)", "Status", "Client approved", "Agency approved"],
      (data ?? []).map((t) => [
        t.workers?.worker_number, t.workers ? `${t.workers.first_name} ${t.workers.last_name}` : "", t.clients?.name, t.client_locations?.name,
        fmt(t.scheduled_start), fmt(t.scheduled_end), fmt(t.actual_start), fmt(t.actual_end), t.break_minutes, hours(t.worked_minutes), hours(t.overtime_minutes), t.late_minutes,
        t.status, fmt(t.client_approved_at), fmt(t.agency_approved_at),
      ]),
    );
  }
  const name = kind === "workers" ? `workers-${today}.csv` : `${kind}-${from}-to-${to}.csv`;
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
