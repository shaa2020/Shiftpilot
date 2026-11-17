"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createInvitation } from "@/lib/invitations";
import { optionalText } from "@/lib/validation/agency";
import { clientInviteSchema } from "@/lib/validation/clients";
import { shiftWindow } from "@/lib/time";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Enter a time");

const requestSchema = z
  .object({
    location_id: z.string().uuid("Choose a location"),
    position_id: z.string().uuid("Choose a position"),
    headcount: z.coerce.number().int().min(1, "At least one worker").max(500),
    date,
    start_time: time,
    end_time: time,
    break_minutes: z.coerce.number().int().min(0).max(240).default(0),
    required_skill_ids: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(uuid)),
    required_language_code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    min_experience_months: z.union([z.literal(""), z.coerce.number().int().min(0).max(600)]).transform((v) => (v === "" ? null : v)).optional(),
    instructions: optionalText(5000),
    client_reference: optionalText(80),
    is_urgent: z.preprocess((v) => v === "on", z.boolean()),
    repeat_days: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int().min(1).max(7))),
    repeat_until: date.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    submit: z.enum(["draft", "submitted"]).default("submitted"),
  })
  .superRefine((d, ctx) => {
    if (d.repeat_days.length && !d.repeat_until) ctx.addIssue({ code: "custom", path: ["repeat_until"], message: "Choose when the series ends" });
    if (d.repeat_until && d.repeat_until < d.date) ctx.addIssue({ code: "custom", path: ["repeat_until"], message: "Must be after the first date" });
  });

export async function createRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClient();
  if (!ctx.capabilities.request) return { ok: false, message: "You are not allowed to request staff." };
  const parsed = requestSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const d = parsed.data;
  const { startsAt, endsAt } = shiftWindow(d.date, d.start_time, d.end_time);
  if (startsAt.getTime() < Date.now()) return { errors: { date: "The shift must be in the future" } };
  const supabase = await createClient();
  const { data: pos } = await supabase.from("job_positions").select("industry_id").eq("id", d.position_id).single();
  const { error } = await supabase.from("shift_requests").insert({
    agency_id: ctx.agencyId, client_id: ctx.clientId, location_id: d.location_id, position_id: d.position_id, industry_id: pos?.industry_id ?? null,
    requested_by: ctx.user.id, status: d.submit, headcount: d.headcount, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    break_minutes: d.break_minutes, required_skill_ids: d.required_skill_ids, required_language_code: d.required_language_code,
    min_experience_months: d.min_experience_months, instructions: d.instructions, client_reference: d.client_reference, is_urgent: d.is_urgent,
    submitted_at: d.submit === "submitted" ? new Date().toISOString() : null,
    recurrence: d.repeat_days.length ? { freq: "weekly", days: d.repeat_days, until: d.repeat_until } : null,
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/client", "layout");
  redirect("/client/requests?created=1");
}

export async function submitDraftRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireClient();
  const supabase = await createClient();
  const { data, error } = await supabase.from("shift_requests").update({ status: "submitted" }).eq("id", uuid.parse(fd.get("id"))).eq("status", "draft").select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error, "The request could not be submitted.") };
  revalidatePath("/client", "layout");
  return { ok: true, message: "Request submitted to the agency." };
}

export async function cancelRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireClient();
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { ok: false, message: "Give a reason." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("shift_requests").update({ status: "cancelled", cancellation_reason: reason }).eq("id", uuid.parse(fd.get("id"))).select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error, "This request can no longer be cancelled; contact the agency.") };
  revalidatePath("/client", "layout");
  return { ok: true, message: "Request cancelled." };
}

export async function clientReplacementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireClient();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_replacement", { p_assignment_id: uuid.parse(fd.get("id")), p_reason: String(fd.get("reason") ?? "") });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/client", "layout");
  return { ok: true, message: "The agency has been asked to arrange a replacement." };
}

export async function reviewTimesheetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireClient();
  const approve = fd.get("approve") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_review_timesheet", { p_timesheet_id: uuid.parse(fd.get("id")), p_approve: approve, p_comment: String(fd.get("reason") ?? "") || undefined });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/client", "layout");
  return { ok: true, message: approve ? "Hours approved." : "Dispute sent to the agency." };
}

export async function inviteTeamMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClient();
  if (!ctx.capabilities.manageUsers) return { ok: false, message: "You are not allowed to manage users." };
  const parsed = clientInviteSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const { email, client_role, ...permissions } = parsed.data;
  const supabase = await createClient();
  const { data: agency } = await supabase.rpc("client_agency_name", { p_client_id: ctx.clientId });
  const res = await createInvitation({
    agencyId: ctx.agencyId, agencyName: (agency as string | null) ?? ctx.clientName,
    inviter: { id: ctx.user.id, name: ctx.user.fullName ?? ctx.user.email }, email,
    audience: `client portal for ${ctx.clientName}`, input: { kind: "client", clientId: ctx.clientId, clientRole: client_role, permissions },
  });
  revalidatePath("/client/team");
  return res;
}

export async function updateTeamMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClient();
  if (!ctx.capabilities.manageUsers) return { ok: false, message: "You are not allowed to manage users." };
  const field = z.enum(["can_request_staff", "can_approve_timesheets", "can_view_finance", "can_manage_users", "status"]).parse(fd.get("field"));
  const value = String(fd.get("value"));
  const patch = field === "status" ? { status: z.enum(["active", "inactive"]).parse(value) } : { [field]: value === "true" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_memberships").update(patch).eq("id", uuid.parse(fd.get("id"))).eq("client_id", ctx.clientId).select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/client/team");
  return { ok: true, message: "Access updated." };
}
