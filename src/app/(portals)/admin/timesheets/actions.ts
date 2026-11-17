"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const refresh = () => {
  revalidatePath("/admin/timesheets", "layout");
  revalidatePath("/admin/attendance");
};

export async function agencyApproveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("timesheets.approve");
  const supabase = await createClient();
  const { error } = await supabase.rpc("agency_approve_timesheet", { p_timesheet_id: uuid.parse(fd.get("id")), p_comment: String(fd.get("reason") ?? "") || undefined });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Timesheet approved by the agency." };
}

export async function bulkAgencyApproveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("timesheets.approve");
  const ids = fd.getAll("ids").map(String).filter((v) => uuid.safeParse(v).success);
  if (!ids.length) return { ok: false, message: "Select at least one timesheet." };
  const supabase = await createClient();
  const failed: string[] = [];
  for (const id of ids) {
    const { error } = await supabase.rpc("agency_approve_timesheet", { p_timesheet_id: id });
    if (error) failed.push(dbErrorMessage(error));
  }
  refresh();
  return failed.length ? { ok: ids.length > failed.length, message: `${ids.length - failed.length} approved, ${failed.length} failed: ${failed[0]}` } : { ok: true, message: `${ids.length} timesheet(s) approved.` };
}

const resolveSchema = z.object({
  actual_start: z.string().min(1, "Enter the start").transform((v) => new Date(v).toISOString()),
  actual_end: z.string().min(1, "Enter the end").transform((v) => new Date(v).toISOString()),
  break_minutes: z.coerce.number().int().min(0).max(600),
  note: z.string().trim().min(5, "Describe the correction").max(2000),
});

export async function resolveDisputeAction(timesheetId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("attendance.correct");
  const parsed = resolveSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  if (d.actual_end <= d.actual_start) return { errors: { actual_end: "End must be after start" } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_timesheet_dispute", { p_timesheet_id: uuid.parse(timesheetId), p_actual_start: d.actual_start, p_actual_end: d.actual_end, p_break_minutes: d.break_minutes, p_note: d.note });
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Corrected and resubmitted to the client." };
}

export async function decideCorrectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("attendance.correct");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_attendance_correction", { p_correction_id: uuid.parse(fd.get("id")), p_approve: fd.get("approve") === "true", p_note: String(fd.get("reason") ?? "") });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: fd.get("approve") === "true" ? "Correction applied." : "Correction rejected." };
}

const staffEntrySchema = z.object({
  assignment_id: uuid,
  event_type: z.enum(["check_in", "check_out", "break_start", "break_end"]),
  occurred_at: z.string().min(1, "Enter the time").transform((v) => new Date(v).toISOString()),
  note: z.string().trim().min(3, "Explain why staff records this").max(1000),
});

export async function staffAttendanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("attendance.correct");
  const parsed = staffEntrySchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_record_attendance", { p_assignment_id: d.assignment_id, p_event_type: d.event_type, p_occurred_at: d.occurred_at, p_note: d.note });
  if (error) return { message: dbErrorMessage(error) };
  refresh();
  return { ok: true, message: "Attendance recorded (marked as staff entry)." };
}
