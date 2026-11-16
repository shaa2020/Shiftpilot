import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dayRange, monthRange, addDays, localDate, zonedMidnight } from "@/lib/time";

export async function getAttendancePolicy(workerId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_attendance_policy", { p_worker_id: workerId });
  return data?.[0] ?? { location_verification_enabled: false, location_privacy_notice: null, timezone: "Europe/Amsterdam" };
}

/** Worked minutes from submitted/approved timesheets this ISO week and month. */
export async function getWorkedMinutes(workerId: string, now = new Date()) {
  const supabase = await createClient();
  const today = localDate(now);
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;
  const weekStart = zonedMidnight(addDays(today, -dow));
  const month = monthRange(now);
  const { data } = await supabase
    .from("timesheets")
    .select("worked_minutes, scheduled_start")
    .eq("worker_id", workerId)
    .neq("status", "draft")
    .gte("scheduled_start", month.start < weekStart ? month.start.toISOString() : weekStart.toISOString());
  const rows = data ?? [];
  const sum = (from: Date) => rows.filter((r) => new Date(r.scheduled_start) >= from).reduce((a, r) => a + (r.worked_minutes ?? 0), 0);
  void dayRange;
  return { week: sum(weekStart), month: sum(month.start) };
}

export function hoursLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
