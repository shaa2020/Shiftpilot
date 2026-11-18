"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { localInputToIso } from "@/lib/time";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { optionalText } from "@/lib/validation/agency";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"] as const;

const leadSchema = z.object({
  company_name: z.string().trim().min(2, "Enter the company name").max(200),
  contact_name: optionalText(120),
  email: optionalText(254).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
  phone: optionalText(30),
  source: optionalText(80),
  industry_id: uuid.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  estimated_monthly_hours: z.union([z.literal(""), z.coerce.number().int().min(0)]).transform((v) => (v === "" ? null : v)).optional(),
  estimated_monthly_value: z.union([z.literal(""), z.coerce.number().min(0)]).transform((v) => (v === "" ? null : v)).optional(),
  next_follow_up_at: z.string().or(z.literal("")).transform((v) => (v === "" ? null : localInputToIso(v))).optional(),
});

export async function createLeadAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("crm.write");
  const parsed = leadSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").insert({ ...parsed.data, agency_id: ctx.agencyId, owner_id: ctx.user.id, created_by: ctx.user.id }).select("id").single();
  if (error || !data) return { message: dbErrorMessage(error) };
  redirect(`/admin/crm/${data.id}`);
}

export async function updateLeadAction(leadId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("crm.write");
  const parsed = leadSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update(parsed.data).eq("id", uuid.parse(leadId));
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/crm/${leadId}`);
  return { ok: true, message: "Lead saved." };
}

export async function setLeadStageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("crm.write");
  const leadId = uuid.parse(fd.get("id"));
  const stage = z.enum(STAGES).parse(fd.get("stage"));
  const reason = String(fd.get("reason") ?? "").trim();
  if (stage === "lost" && reason.length < 3) return { ok: false, message: "Give a reason for losing the lead." };
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ stage, lost_reason: stage === "lost" ? reason : null }).eq("id", leadId);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/crm", "layout");
  return { ok: true, message: `Moved to ${stage}.` };
}

export async function setLeadOwnerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("crm.write");
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ owner_id: uuid.parse(fd.get("owner_id")) }).eq("id", uuid.parse(fd.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/crm", "layout");
  return { ok: true, message: "Lead reassigned." };
}

const activitySchema = z.object({
  activity_type: z.enum(["note", "call", "email", "meeting", "task"]),
  subject: optionalText(200),
  body: optionalText(5000),
  due_at: z.string().or(z.literal("")).transform((v) => (v === "" ? null : localInputToIso(v))).optional(),
});

export async function addActivityAction(leadId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("crm.write");
  const parsed = activitySchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  if (!parsed.data.subject && !parsed.data.body) return { errors: { subject: "Add a subject or a note" } };
  const supabase = await createClient();
  const { error } = await supabase.from("lead_activities").insert({ ...parsed.data, agency_id: ctx.agencyId, lead_id: uuid.parse(leadId), created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  if (parsed.data.activity_type === "task" && parsed.data.due_at) {
    await supabase.from("leads").update({ next_follow_up_at: parsed.data.due_at }).eq("id", leadId);
  }
  revalidatePath(`/admin/crm/${leadId}`);
  return { ok: true, message: "Activity logged." };
}

export async function completeActivityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("crm.write");
  const supabase = await createClient();
  const { data, error } = await supabase.from("lead_activities").update({ completed_at: new Date().toISOString() }).eq("id", uuid.parse(fd.get("id"))).select("lead_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/admin/crm/${data[0].lead_id}`);
  return { ok: true, message: "Task completed." };
}

/** Creates a client from a lead and marks the lead won. */
export async function convertLeadAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("crm.write", "clients.write");
  const leadId = uuid.parse(fd.get("id"));
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
  if (!lead) return { ok: false, message: "Lead not found." };
  if (lead.converted_client_id) return { ok: false, message: "This lead has already been converted." };
  const { data: client, error } = await supabase
    .from("clients")
    .insert({ agency_id: ctx.agencyId, name: lead.company_name, industry_id: lead.industry_id, billing_email: lead.email, account_manager_id: lead.owner_id ?? ctx.user.id })
    .select("id")
    .single();
  if (error || !client) return { ok: false, message: dbErrorMessage(error) };
  if (lead.contact_name) {
    await supabase.from("client_contacts").insert({ agency_id: ctx.agencyId, client_id: client.id, full_name: lead.contact_name, email: lead.email, phone: lead.phone, is_primary: true });
  }
  const { error: uErr } = await supabase.from("leads").update({ stage: "won", converted_client_id: client.id }).eq("id", leadId);
  if (uErr) return { ok: false, message: dbErrorMessage(uErr) };
  redirect(`/admin/clients/${client.id}`);
}
