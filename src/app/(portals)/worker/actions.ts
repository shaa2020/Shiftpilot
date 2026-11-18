"use server";
import { geocode } from "@/lib/geo/geocode";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { optionalText } from "@/lib/validation/agency";
import { availabilitySchema, languageSchema, skillSchema } from "@/lib/validation/workers";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const refreshWorker = () => revalidatePath("/worker", "layout");

const attendanceInput = z.object({
  assignmentId: uuid,
  type: z.enum(["check_in", "check_out", "break_start", "break_end"]),
  key: z.string().min(8).max(100),
  deviceTime: z.string().datetime({ offset: true }),
  offline: z.boolean(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accuracy: z.number().min(0).max(100000).nullable(),
});

export async function recordAttendanceAction(input: z.infer<typeof attendanceInput>): Promise<ActionState & { status?: string }> {
  await requireWorker();
  const d = attendanceInput.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_attendance", {
    p_assignment_id: d.assignmentId, p_event_type: d.type, p_idempotency_key: d.key, p_device_time: d.deviceTime, p_offline: d.offline,
    p_latitude: d.latitude ?? undefined, p_longitude: d.longitude ?? undefined, p_accuracy_m: d.accuracy ?? undefined,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshWorker();
  const res = data as { status: string; duplicate: boolean };
  const labels: Record<string, string> = { check_in: "Checked in", check_out: "Checked out — your timesheet was sent for approval", break_start: "Break started", break_end: "Break ended" };
  return { ok: true, message: d.offline ? `${labels[d.type]} (synchronised from offline)` : labels[d.type], status: res.status };
}

export async function respondInvitationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireWorker();
  const accept = fd.get("accept") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_shift_invitation", { p_invitation_id: uuid.parse(fd.get("id")), p_accept: accept, p_reason: String(fd.get("reason") ?? "") || undefined });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshWorker();
  return { ok: true, message: accept ? "Accepted — the agency will confirm your shift." : "Offer declined." };
}

export async function respondAssignmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireWorker();
  const accept = fd.get("accept") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_assignment", { p_assignment_id: uuid.parse(fd.get("id")), p_accept: accept, p_reason: String(fd.get("reason") ?? "") || undefined });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshWorker();
  return { ok: true, message: accept ? "Accepted — the agency will confirm your shift." : "Declined." };
}

export async function clarifyInvitationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireWorker();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_invitation_clarification", { p_invitation_id: uuid.parse(fd.get("id")), p_question: String(fd.get("reason") ?? "") });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  return { ok: true, message: "Your question was sent to the agency." };
}

export async function expressInterestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const { error } = await supabase.rpc("express_shift_interest", { p_shift_position_id: uuid.parse(fd.get("id")), p_worker_id: ctx.workerId });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  return { ok: true, message: "The agency has been told you are interested." };
}

export async function reportAbsenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireWorker();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_replacement", { p_assignment_id: uuid.parse(fd.get("id")), p_reason: String(fd.get("reason") ?? "") });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshWorker();
  return { ok: true, message: "The agency has been notified and will arrange a replacement." };
}

const correctionSchema = z.object({
  timesheet_id: uuid,
  proposed_start: z.string().or(z.literal("")).transform((v) => (v === "" ? null : new Date(v).toISOString())).optional(),
  proposed_end: z.string().or(z.literal("")).transform((v) => (v === "" ? null : new Date(v).toISOString())).optional(),
  proposed_break_minutes: z.union([z.literal(""), z.coerce.number().int().min(0).max(240)]).transform((v) => (v === "" ? null : v)).optional(),
  reason: z.string().trim().min(5, "Explain what should be corrected").max(2000),
});

export async function requestCorrectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireWorker();
  const parsed = correctionSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  if (!d.proposed_start && !d.proposed_end && d.proposed_break_minutes == null) return { errors: { proposed_start: "Change at least one value" } };
  const supabase = await createClient();
  const { error } = await supabase.from("attendance_corrections").insert({ ...d, agency_id: ctx.agencyId, requested_by: ctx.user.id, requester_type: "worker" });
  if (error) return { message: dbErrorMessage(error) };
  refreshWorker();
  return { ok: true, message: "Correction requested. The agency will review it." };
}

// ----- Self-service profile ------------------------------------------------
async function insertOwn(table: "worker_skills" | "worker_languages" | "worker_availability", row: Record<string, unknown>): Promise<ActionState> {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert({ ...row, agency_id: ctx.agencyId, worker_id: ctx.workerId } as never);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/worker/profile");
  return { ok: true, message: "Saved." };
}
export async function addOwnSkillAction(_p: ActionState, fd: FormData) {
  const parsed = skillSchema.safeParse(formObject(fd));
  return parsed.success ? insertOwn("worker_skills", parsed.data) : { errors: zodErrors(parsed.error) };
}
export async function addOwnLanguageAction(_p: ActionState, fd: FormData) {
  const parsed = languageSchema.safeParse(formObject(fd));
  return parsed.success ? insertOwn("worker_languages", parsed.data) : { errors: zodErrors(parsed.error) };
}
export async function addOwnAvailabilityAction(_p: ActionState, fd: FormData) {
  const parsed = availabilitySchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  return insertOwn("worker_availability", d.kind === "recurring"
    ? { kind: d.kind, day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time, note: d.note }
    : { kind: d.kind, date_from: d.date_from, date_to: d.date_to, start_time: d.start_time, end_time: d.end_time, note: d.note });
}
export async function removeOwnItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireWorker();
  const table = z.enum(["worker_skills", "worker_languages", "worker_availability"]).parse(fd.get("table"));
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).delete().eq("id", uuid.parse(fd.get("id"))).eq("worker_id", ctx.workerId).select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error, "Could not remove.") };
  revalidatePath("/worker/profile");
  return { ok: true, message: "Removed." };
}

const personalSchema = z.object({
  phone: optionalText(30),
  city: optionalText(100),
  postal_code: optionalText(12),
  max_travel_km: z.union([z.literal(""), z.coerce.number().int().min(0).max(500)]).transform((v) => (v === "" ? null : v)).optional(),
  professional_summary: optionalText(2000),
  address_line1: optionalText(200),
  emergency_contact_name: optionalText(120),
  emergency_contact_phone: optionalText(30),
  emergency_contact_relationship: optionalText(60),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
});

export async function updateOwnDetailsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireWorker();
  const parsed = personalSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const { phone, city, postal_code, max_travel_km, professional_summary, ...priv } = parsed.data;
  const supabase = await createClient();
  // Postcode-level coordinates for travel-distance matching (only when geocoding is enabled).
  const point = await geocode({ postalCode: postal_code, city });
  const w = await supabase.from("workers").update({ phone, city, postal_code, max_travel_km, professional_summary, ...(point ? { home_latitude: point.latitude, home_longitude: point.longitude } : {}) }).eq("id", ctx.workerId);
  if (w.error) return { message: dbErrorMessage(w.error) };
  const p = await supabase.from("worker_private_details").update(priv).eq("worker_id", ctx.workerId);
  if (p.error) return { message: dbErrorMessage(p.error) };
  await supabase.from("onboarding_tasks").update({ status: "submitted" }).eq("worker_id", ctx.workerId).eq("task_type", "personal_info").eq("status", "pending");
  revalidatePath("/worker", "layout");
  return { ok: true, message: "Details saved." };
}

export async function submitTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireWorker();
  const supabase = await createClient();
  const { data, error } = await supabase.from("onboarding_tasks").update({ status: "submitted" }).eq("id", uuid.parse(fd.get("id"))).eq("staff_only", false).select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error, "This task cannot be submitted.") };
  revalidatePath("/worker", "layout");
  return { ok: true, message: "Marked as done. The agency will review it." };
}
