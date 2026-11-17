import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/finance/csv";

/** CSV of a payroll export (RLS: payroll.export). One row per timesheet. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: exp } = await supabase.from("payroll_exports").select("id, agency_id, payroll_periods(name, period_start, period_end)").eq("id", id).maybeSingle();
  if (!exp) return new NextResponse("Not found", { status: 404 });
  const { data: lines } = await supabase
    .from("payroll_export_lines")
    .select("hourly_gross, minutes_by_kind, workers(worker_number, first_name, last_name), timesheets(scheduled_start, shifts(title, clients(name)))")
    .eq("payroll_export_id", id);
  const hours = (m: unknown) => (Number(m ?? 0) / 60).toFixed(2);
  const rows = (lines ?? []).map((l) => {
    const k = l.minutes_by_kind as Record<string, number>;
    return [
      l.workers?.worker_number ?? "", l.workers?.first_name ?? "", l.workers?.last_name ?? "", l.timesheets?.scheduled_start?.slice(0, 10) ?? "",
      l.timesheets?.shifts?.clients?.name ?? "", l.timesheets?.shifts?.title ?? "", hours(k.total), hours(k.regular), hours(k.night), hours(k.weekend),
      hours(k.public_holiday), hours(k.overtime), hours(k.break), l.hourly_gross ?? "",
    ];
  });
  const csv = toCsv(["worker_number", "first_name", "last_name", "date", "client", "shift", "hours_total", "hours_regular", "hours_night", "hours_weekend", "hours_public_holiday", "hours_overtime", "break_hours", "gross_hourly_wage"], rows);
  await supabase.rpc("log_audit_event", { p_agency_id: exp.agency_id, p_action: "payroll_export.download", p_table: "payroll_exports", p_record_id: id });
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="payroll-${exp.payroll_periods?.period_start}-${exp.payroll_periods?.period_end}.csv"`, "Cache-Control": "private, no-store" },
  });
}
