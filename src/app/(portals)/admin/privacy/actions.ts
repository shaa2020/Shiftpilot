"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { zonedDateTime } from "@/lib/time";
import { dbErrorMessage, zodErrors, type ActionState } from "@/lib/actions/state";

const done = (message: string): ActionState => {
  revalidatePath("/admin/privacy");
  return { ok: true, message };
};
const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

export async function createRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("gdpr.manage");
  const parsed = z.object({
    subject_email: z.string().trim().email("Enter the subject's email"),
    request_type: z.enum(["access", "export", "rectification", "erasure", "restriction", "objection"]),
    details: z.string().max(4000).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("data_subject_requests").insert({ ...parsed.data, agency_id: ctx.agencyId, handled_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  return done("Request logged. The statutory deadline is one month from today.");
}

export async function updateRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("gdpr.manage");
  const parsed = z.object({
    id: z.string().uuid(),
    status: z.enum(["verifying", "in_progress", "completed", "rejected"]),
    outcome: z.string().max(4000).optional(),
    retained: z.string().max(2000).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { message: "Invalid request." };
  const d = parsed.data;
  const closing = d.status === "completed" || d.status === "rejected";
  if (closing && (d.outcome ?? "").trim().length < 5) return { errors: { outcome: "Describe the outcome before closing the request" } };
  const supabase = await createClient();
  const { error } = await supabase.from("data_subject_requests").update({
    status: d.status, handled_by: ctx.user.id,
    ...(closing ? { outcome: d.outcome!.trim(), completed_at: new Date().toISOString() } : {}),
    ...(d.retained ? { retained_records: list(d.retained) } : {}),
  }).eq("id", d.id);
  if (error) return { message: dbErrorMessage(error) };
  return done(closing ? "Request closed." : "Status updated.");
}

export async function anonymiseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("gdpr.manage");
  const kind = z.enum(["worker", "application"]).parse(fd.get("kind"));
  const id = z.string().uuid().parse(fd.get("id"));
  const supabase = await createClient();
  const { error } = kind === "worker" ? await supabase.rpc("anonymise_worker", { p_worker_id: id }) : await supabase.rpc("anonymise_application", { p_application_id: id });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/admin/workers");
  return done("Personal data anonymised. Records kept for legal retention no longer identify the person.");
}

export async function saveActivityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("gdpr.manage");
  const parsed = z.object({
    name: z.string().trim().min(3).max(200),
    purpose: z.string().trim().min(3).max(2000),
    lawful_basis: z.enum(["consent", "contract", "legal_obligation", "vital_interests", "public_task", "legitimate_interests"]),
    data_categories: z.string().trim().min(2, "List at least one category"),
    data_subjects: z.string().trim().min(2, "List at least one group"),
    recipients: z.string().max(2000).optional(),
    retention_description: z.string().trim().min(3).max(2000),
    security_measures: z.string().max(2000).optional(),
    processors: z.string().max(2000).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const { data: last } = await supabase.from("processing_activities").select("version").eq("agency_id", ctx.agencyId).eq("name", d.name).order("version", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("processing_activities").insert({ ...d, agency_id: ctx.agencyId, data_categories: list(d.data_categories), data_subjects: list(d.data_subjects), version: (last?.version ?? 0) + 1 });
  if (error) return { message: dbErrorMessage(error) };
  return done(last ? `Saved as version ${last.version + 1}.` : "Processing activity recorded.");
}

export async function saveRetentionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("gdpr.manage");
  const parsed = z.object({
    data_category: z.string().trim().min(2).max(120),
    table_name: z.string().trim().regex(/^[a-z_]{2,63}$/, "Use the table name, e.g. applications"),
    retention_months: z.coerce.number().int().min(1).max(1200),
    legal_basis: z.string().trim().min(3).max(1000),
    action: z.enum(["delete", "anonymise", "archive"]),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("data_retention_records").upsert({ ...parsed.data, agency_id: ctx.agencyId }, { onConflict: "agency_id,data_category,table_name" });
  if (error) return { message: dbErrorMessage(error) };
  return done("Retention period saved.");
}

export async function recordBreachAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("gdpr.manage");
  const parsed = z.object({
    detected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "When was it detected?"),
    description: z.string().trim().min(10).max(4000),
    data_categories: z.string().max(1000).optional(),
    approx_subjects: z.string().regex(/^\d*$/).optional(),
    risk_assessment: z.string().max(4000).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  const detected = zonedDateTime(d.detected_at.slice(0, 10), d.detected_at.slice(11, 16));
  if (Number.isNaN(detected.getTime())) return { errors: { detected_at: "Invalid date" } };
  const supabase = await createClient();
  const { error } = await supabase.from("breach_records").insert({
    agency_id: ctx.agencyId, detected_at: detected.toISOString(), description: d.description, data_categories: list(d.data_categories ?? ""),
    approx_subjects: d.approx_subjects ? Number(d.approx_subjects) : null, risk_assessment: d.risk_assessment || null, recorded_by: ctx.user.id,
  });
  if (error) return { message: dbErrorMessage(error) };
  return done("Breach recorded. Assess within 72 hours whether the supervisory authority must be notified.");
}

export async function updateBreachAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("gdpr.manage");
  const id = z.string().uuid().parse(fd.get("id"));
  const field = z.enum(["reported", "notified", "contained", "closed"]).parse(fd.get("field"));
  const note = String(fd.get("reason") ?? "").trim();
  const now = new Date().toISOString();
  const patch =
    field === "reported" ? { reported_to_authority_at: now } :
    field === "notified" ? { subjects_notified_at: now } :
    { status: field, ...(note ? { measures_taken: note } : {}) };
  const supabase = await createClient();
  const { error } = await supabase.from("breach_records").update(patch).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  return done("Breach record updated.");
}
