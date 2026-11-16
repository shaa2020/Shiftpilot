"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { shiftWindow, localDate, localTime } from "@/lib/time";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";
import { rescheduleSchema, shiftFormSchema } from "@/lib/validation/shifts";

const uuid = z.string().uuid();
const refresh = (shiftId?: string) => {
  revalidatePath("/admin/shifts");
  revalidatePath("/admin/schedule");
  if (shiftId) revalidatePath(`/admin/shifts/${shiftId}`);
};
const reasonOf = (fd: FormData) => String(fd.get("reason") ?? "").trim();

export async function createShiftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.write");
  const parsed = shiftFormSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const d = parsed.data;
  const { startsAt, endsAt } = shiftWindow(d.date, d.start_time, d.end_time);
  const supabase = await createClient();
  const { data: loc } = await supabase.from("client_locations").select("client_id").eq("id", d.location_id).single();
  if (!loc) return { errors: { location_id: "Choose a location" } };
  const payload = {
    client_id: loc.client_id, location_id: d.location_id, title: d.title, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    break_minutes: d.break_minutes, dress_code: d.dress_code, instructions: d.instructions, status: d.status,
    positions: [{ position_id: d.position_id, headcount: d.headcount, allowed_engagements: d.allow_freelancers ? ["employee", "freelancer"] : ["employee"], required_language_code: d.required_language_code }],
    ...(d.repeat_days.length ? { recurrence: { days: d.repeat_days, until: d.repeat_until } } : {}),
  };
  const { data, error } = await supabase.rpc("create_shifts", { p: payload });
  if (error || !data?.length) return { message: dbErrorMessage(error, "The shift could not be created.") };
  refresh();
  redirect(data.length === 1 ? `/admin/shifts/${data[0]}` : `/admin/shifts?created=${data.length}`);
}

export async function duplicateShiftAction(shiftId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.write");
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(fd.get("date"));
  if (!date.success) return { errors: { date: "Choose a date" } };
  const supabase = await createClient();
  const { data: s } = await supabase.from("shifts").select("*, shift_positions(*)").eq("id", uuid.parse(shiftId)).single();
  if (!s) return { ok: false, message: "Shift not found." };
  const { startsAt, endsAt } = shiftWindow(date.data, localTime(s.starts_at), localTime(s.ends_at));
  const { data, error } = await supabase.rpc("create_shifts", {
    p: {
      client_id: s.client_id, location_id: s.location_id, title: s.title, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
      break_minutes: s.break_minutes, dress_code: s.dress_code, instructions: s.instructions, status: "open",
      positions: s.shift_positions.map((p) => ({ position_id: p.position_id, headcount: p.headcount, allowed_engagements: p.allowed_engagements, required_skill_ids: p.required_skill_ids, required_language_code: p.required_language_code, min_experience_months: p.min_experience_months, notes: p.notes })),
    },
  });
  if (error || !data?.length) return { message: dbErrorMessage(error, "The shift could not be duplicated.") };
  redirect(`/admin/shifts/${data[0]}`);
}

export async function addShiftPositionAction(shiftId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("shifts.write");
  const parsed = z.object({
    position_id: uuid, headcount: z.coerce.number().int().min(1).max(500), allow_freelancers: z.preprocess((v) => v === "on", z.boolean()),
    required_language_code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("shift_positions").insert({
    agency_id: ctx.agencyId, shift_id: uuid.parse(shiftId), position_id: parsed.data.position_id, headcount: parsed.data.headcount,
    allowed_engagements: parsed.data.allow_freelancers ? ["employee", "freelancer"] : ["employee"], required_language_code: parsed.data.required_language_code,
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh(shiftId);
  return { ok: true, message: "Position added." };
}

export async function updateHeadcountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.write");
  const headcount = z.coerce.number().int().min(1).max(500).parse(fd.get("headcount"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("shift_positions").update({ headcount }).eq("id", uuid.parse(fd.get("id"))).select("shift_id");
  if (error || !data?.length) return { ok: false, message: error?.code === "23514" ? "Headcount cannot be lower than the number of workers already assigned." : dbErrorMessage(error) };
  refresh(data[0].shift_id);
  return { ok: true, message: "Headcount updated." };
}

export async function setShiftStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.write");
  const shiftId = uuid.parse(fd.get("id"));
  const status = z.enum(["draft", "open", "cancelled"]).parse(fd.get("status"));
  const reason = reasonOf(fd);
  if (status === "cancelled" && reason.length < 3) return { ok: false, message: "Give a cancellation reason." };
  const supabase = await createClient();
  const patch = status === "cancelled" ? { status, cancelled_at: new Date().toISOString(), cancellation_reason: reason } : { status };
  const { error } = await supabase.from("shifts").update(patch).eq("id", shiftId);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(shiftId);
  return { ok: true, message: status === "cancelled" ? "Shift cancelled; workers and client notified." : `Shift set to ${status}.` };
}

export async function rescheduleShiftAction(shiftId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.write");
  const parsed = rescheduleSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const { startsAt, endsAt } = shiftWindow(parsed.data.date, parsed.data.start_time, parsed.data.end_time);
  return applyReschedule(shiftId, startsAt.toISOString(), endsAt.toISOString(), parsed.data.break_minutes);
}

/** Used by calendar drag-and-drop. */
export async function moveShiftAction(shiftId: string, startsAt: string, endsAt: string): Promise<ActionState> {
  await requireStaff("shifts.write");
  return applyReschedule(shiftId, z.string().datetime({ offset: true }).parse(startsAt), z.string().datetime({ offset: true }).parse(endsAt));
}

async function applyReschedule(shiftId: string, startsAt: string, endsAt: string, breakMinutes?: number): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("shifts")
    .update({ starts_at: startsAt, ends_at: endsAt, ...(breakMinutes !== undefined ? { break_minutes: breakMinutes } : {}) })
    .eq("id", uuid.parse(shiftId));
  if (error) {
    return { ok: false, message: error.code === "23P01" ? "Rescheduling would double-book an assigned worker. Reassign first." : dbErrorMessage(error) };
  }
  refresh(shiftId);
  return { ok: true, message: `Shift moved to ${localDate(new Date(startsAt))} ${localTime(startsAt)}; assigned workers notified.` };
}

export async function inviteWorkersAction(positionId: string, shiftId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.assign");
  const ids = fd.getAll("worker_ids").map(String).filter((v) => uuid.safeParse(v).success);
  if (!ids.length) return { ok: false, message: "Select at least one worker." };
  const hours = Number(fd.get("expires_hours") || 0);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_workers", {
    p_shift_position_id: uuid.parse(positionId),
    p_worker_ids: ids,
    p_expires_at: hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : undefined,
    p_override_reason: reasonOf(fd) || undefined,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(shiftId);
  const r = data as { invited: number; skipped: { reason: string }[] };
  return r.skipped.length
    ? { ok: r.invited > 0, message: `${r.invited} invited. ${r.skipped.length} skipped: ${r.skipped.map((s) => s.reason).join(" | ")}` }
    : { ok: true, message: `${r.invited} worker(s) invited.` };
}

export async function assignWorkerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.assign");
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_worker", {
    p_shift_position_id: uuid.parse(fd.get("position_id")), p_worker_id: uuid.parse(fd.get("worker_id")), p_override_reason: reasonOf(fd) || undefined,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(uuid.parse(fd.get("shift_id")));
  return { ok: true, message: "Worker assigned; waiting for their acceptance." };
}

async function assignmentRpc(fn: "confirm_assignment" | "cancel_assignment" | "mark_no_show" | "withdraw_invitation", fd: FormData, ok: string): Promise<ActionState> {
  await requireStaff("shifts.assign");
  const supabase = await createClient();
  const id = uuid.parse(fd.get("id"));
  const { error } =
    fn === "cancel_assignment" ? await supabase.rpc(fn, { p_assignment_id: id, p_reason: reasonOf(fd) })
    : fn === "withdraw_invitation" ? await supabase.rpc(fn, { p_invitation_id: id })
    : await supabase.rpc(fn, { p_assignment_id: id });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(String(fd.get("shift_id") ?? ""));
  return { ok: true, message: ok };
}
export async function confirmAssignmentAction(_p: ActionState, fd: FormData) { return assignmentRpc("confirm_assignment", fd, "Assignment confirmed; rates locked."); }
export async function cancelAssignmentAction(_p: ActionState, fd: FormData) { return assignmentRpc("cancel_assignment", fd, "Assignment cancelled."); }
export async function noShowAction(_p: ActionState, fd: FormData) { return assignmentRpc("mark_no_show", fd, "No-show recorded."); }
export async function withdrawInvitationAction(_p: ActionState, fd: FormData) { return assignmentRpc("withdraw_invitation", fd, "Invitation withdrawn."); }

export async function replaceAssignmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("shifts.assign");
  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_assignment", {
    p_assignment_id: uuid.parse(fd.get("id")), p_new_worker_id: uuid.parse(fd.get("worker_id")), p_override_reason: reasonOf(fd) || undefined,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(String(fd.get("shift_id") ?? ""));
  return { ok: true, message: "Replacement assigned." };
}

// ----- Requests ---------------------------------------------------------------
export async function acceptRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("requests.review", "shifts.write");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_shift_request", { p_request_id: uuid.parse(fd.get("id")), p_title: reasonOf(fd) || undefined });
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/requests", "layout");
  redirect(data.length === 1 ? `/admin/shifts/${data[0]}` : `/admin/shifts`);
}

export async function rejectRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("requests.review");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_shift_request", { p_request_id: uuid.parse(fd.get("id")), p_reason: reasonOf(fd) });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/requests", "layout");
  return { ok: true, message: "Request rejected; the client has been notified." };
}

export async function markUnderReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("requests.review");
  const supabase = await createClient();
  const { error } = await supabase.from("shift_requests").update({ status: "under_review" }).eq("id", uuid.parse(fd.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/requests", "layout");
  return { ok: true, message: "Marked as under review." };
}
