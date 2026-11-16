"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createInvitation } from "@/lib/invitations";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";
import {
  availabilitySchema, businessSchema, certificateSchema, employmentContractSchema, freelancerAgreementSchema,
  freelancerRateSchema, languageSchema, privateDetailsSchema, skillSchema, wageRateSchema, workerProfileSchema, workerSchema,
} from "@/lib/validation/workers";

const uuid = z.string().uuid();
const invalid = (e: z.ZodError): ActionState => ({ errors: zodErrors(e), message: "Please correct the highlighted fields." });
const refresh = (workerId: string) => revalidatePath(`/admin/workers/${workerId}`);

export async function createWorkerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const parsed = workerSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workers")
    .insert({ ...parsed.data, agency_id: ctx.agencyId, created_by: ctx.user.id, status: "invited" })
    .select("id")
    .single();
  if (error || !data) return { message: dbErrorMessage(error) };
  redirect(`/admin/workers/${data.id}?created=1`);
}

export async function updateWorkerProfileAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("workers.write");
  const parsed = workerProfileSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("workers").update(parsed.data).eq("id", uuid.parse(workerId)).select("id");
  if (error || !data?.length) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: "Profile saved." };
}

export async function inviteWorkerAction(workerId: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const supabase = await createClient();
  const { data: w } = await supabase.from("workers").select("email, user_id").eq("id", uuid.parse(workerId)).single();
  if (!w) return { ok: false, message: "Worker not found." };
  if (w.user_id) return { ok: false, message: "This worker already has an account." };
  const res = await createInvitation({
    agencyId: ctx.agencyId,
    agencyName: ctx.agencyName,
    inviter: { id: ctx.user.id, name: ctx.user.fullName ?? ctx.user.email },
    email: w.email,
    audience: "worker portal",
    input: { kind: "worker", workerId },
  });
  refresh(workerId);
  return res;
}

export async function setWorkerStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("workers.write");
  const workerId = uuid.parse(formData.get("id"));
  const status = z.enum(["onboarding", "pending_review", "active", "suspended", "inactive", "archived"]).parse(formData.get("status"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("workers").update({ status }).eq("id", workerId).select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  refresh(workerId);
  revalidatePath("/admin/workers");
  return { ok: true, message: `Worker status changed to ${status.replace("_", " ")}.` };
}

export async function updatePrivateDetailsAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.sensitive.read", "workers.write");
  const parsed = privateDetailsSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("worker_private_details")
    .select("identity_verification_status, work_eligibility_status")
    .eq("worker_id", workerId)
    .single();
  const now = new Date().toISOString();
  const patch = {
    ...parsed.data,
    ...(current?.identity_verification_status !== parsed.data.identity_verification_status
      ? { identity_verified_at: parsed.data.identity_verification_status === "verified" ? now : null, identity_verified_by: parsed.data.identity_verification_status === "verified" ? ctx.user.id : null }
      : {}),
    ...(current?.work_eligibility_status !== parsed.data.work_eligibility_status
      ? { work_eligibility_verified_at: parsed.data.work_eligibility_status === "verified" ? now : null, work_eligibility_verified_by: parsed.data.work_eligibility_status === "verified" ? ctx.user.id : null }
      : {}),
  };
  const { data, error } = await supabase.from("worker_private_details").update(patch).eq("worker_id", uuid.parse(workerId)).select("worker_id");
  if (error || !data?.length) return { message: dbErrorMessage(error) };
  // Keep the staff-only onboarding tasks in step with the verification outcome.
  for (const [type, status] of [["identity_check", parsed.data.identity_verification_status], ["work_eligibility", parsed.data.work_eligibility_status]] as const) {
    if (status === "verified") {
      await supabase.from("onboarding_tasks").update({ status: "completed", completed_at: now, completed_by: ctx.user.id }).eq("worker_id", workerId).eq("task_type", type).neq("status", "completed");
    }
  }
  refresh(workerId);
  return { ok: true, message: "Details saved." };
}

async function insertFor(workerId: string, table: "worker_skills" | "worker_languages" | "worker_certificates" | "worker_availability", row: Record<string, unknown>, success: string): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert({ ...row, agency_id: ctx.agencyId, worker_id: uuid.parse(workerId) } as never);
  if (error) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: success };
}

export async function addSkillAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = skillSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  return insertFor(workerId, "worker_skills", parsed.data, "Skill added.");
}

export async function addLanguageAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = languageSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  return insertFor(workerId, "worker_languages", parsed.data, "Language added.");
}

export async function addCertificateAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = certificateSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  return insertFor(workerId, "worker_certificates", parsed.data, "Certificate added (pending verification).");
}

export async function addAvailabilityAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = availabilitySchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;
  const row = d.kind === "recurring"
    ? { kind: d.kind, day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time, note: d.note }
    : { kind: d.kind, date_from: d.date_from, date_to: d.date_to, start_time: d.start_time, end_time: d.end_time, note: d.note };
  return insertFor(workerId, "worker_availability", row, "Availability saved.");
}

const removable = z.enum(["worker_skills", "worker_languages", "worker_availability", "worker_certificates"]);

export async function removeWorkerItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("workers.write");
  const table = removable.parse(formData.get("table"));
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).delete().eq("id", uuid.parse(formData.get("id"))).select("worker_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error, "The item could not be removed.") };
  refresh(data[0].worker_id);
  return { ok: true, message: "Removed." };
}

export async function verifyCertificateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("documents.verify");
  const status = z.enum(["verified", "rejected"]).parse(formData.get("status"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_certificates")
    .update({ status, verified_by: ctx.user.id, verified_at: new Date().toISOString() })
    .eq("id", uuid.parse(formData.get("id")))
    .select("worker_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  refresh(data[0].worker_id);
  return { ok: true, message: status === "verified" ? "Certificate verified." : "Certificate rejected." };
}

export async function setOnboardingTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const status = z.enum(["pending", "completed", "waived", "blocked"]).parse(formData.get("status"));
  const supabase = await createClient();
  const done = status === "completed" || status === "waived";
  const { data, error } = await supabase
    .from("onboarding_tasks")
    .update({ status, completed_at: done ? new Date().toISOString() : null, completed_by: done ? ctx.user.id : null })
    .eq("id", uuid.parse(formData.get("id")))
    .select("worker_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  refresh(data[0].worker_id);
  return { ok: true, message: "Task updated." };
}

export async function addWorkerNoteAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.notes.read");
  const body = z.string().trim().min(1, "Write a note").max(10000).safeParse(formData.get("body"));
  if (!body.success) return { errors: { body: body.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.from("internal_notes").insert({ agency_id: ctx.agencyId, subject_type: "worker", subject_id: uuid.parse(workerId), body: body.data, created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: "Note added." };
}

// ----- Employee pathway -----------------------------------------------------
export async function addEmploymentContractAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const parsed = employmentContractSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("employment_contracts").insert({ ...parsed.data, agency_id: ctx.agencyId, worker_id: uuid.parse(workerId), created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: "Contract draft created." };
}

export async function setEmploymentContractStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const status = z.enum(["pending_signature", "active", "ended", "terminated", "cancelled"]).parse(formData.get("status"));
  const supabase = await createClient();
  const patch = status === "active" ? { status, signed_at: new Date().toISOString(), signature_method: "external_esign" } : { status };
  const { data, error } = await supabase.from("employment_contracts").update(patch).eq("id", uuid.parse(formData.get("id"))).select("worker_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  if (status === "active") {
    await supabase.from("onboarding_tasks").update({ status: "completed", completed_at: new Date().toISOString(), completed_by: ctx.user.id }).eq("worker_id", data[0].worker_id).eq("task_type", "contract");
  }
  refresh(data[0].worker_id);
  return { ok: true, message: "Contract updated." };
}

export async function addWageRateAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("rates.write");
  const parsed = wageRateSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  // End the currently open rate for the same scope the day before the new one starts.
  const prevDay = new Date(new Date(parsed.data.effective_from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  let open = supabase.from("wage_rates").update({ effective_to: prevDay }).eq("worker_id", workerId).is("effective_to", null).lt("effective_from", parsed.data.effective_from);
  open = parsed.data.position_id ? open.eq("position_id", parsed.data.position_id) : open.is("position_id", null);
  await open;
  const { error } = await supabase.from("wage_rates").insert({ ...parsed.data, agency_id: ctx.agencyId, worker_id: uuid.parse(workerId), created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: "Wage rate added." };
}

// ----- Freelancer pathway ---------------------------------------------------
export async function saveBusinessAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const parsed = businessSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data: existing } = await supabase.from("freelancer_businesses").select("id").eq("worker_id", workerId).maybeSingle();
  const { error } = existing
    ? await supabase.from("freelancer_businesses").update(parsed.data).eq("id", existing.id)
    : await supabase.from("freelancer_businesses").insert({ ...parsed.data, agency_id: ctx.agencyId, worker_id: uuid.parse(workerId) });
  if (error) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: "Business details saved." };
}

/** Records a compliance decision; the classification is never inferred automatically. */
export async function reviewClassificationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("compliance.review");
  const businessId = uuid.parse(formData.get("business_id"));
  const workerId = uuid.parse(formData.get("worker_id"));
  const outcome = z.enum(["approved", "restricted", "rejected"]).parse(formData.get("outcome"));
  const rationale = z.string().trim().min(10, "Explain the decision (at least 10 characters)").max(5000).safeParse(formData.get("reason"));
  if (!rationale.success) return { ok: false, message: rationale.error.issues[0].message };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data: review, error: rErr } = await supabase
    .from("compliance_reviews")
    .insert({ agency_id: ctx.agencyId, review_type: "freelancer_classification", worker_id: workerId, freelancer_business_id: businessId, requested_by: ctx.user.id })
    .select("id")
    .single();
  if (rErr || !review) return { ok: false, message: dbErrorMessage(rErr) };
  const { error: dErr } = await supabase
    .from("compliance_reviews")
    .update({ status: outcome, rationale: rationale.data, decided_by: ctx.user.id, decided_at: now })
    .eq("id", review.id);
  if (dErr) return { ok: false, message: dbErrorMessage(dErr) };
  const { error } = await supabase
    .from("freelancer_businesses")
    .update({ classification_status: outcome, classification_reviewed_by: ctx.user.id, classification_reviewed_at: now })
    .eq("id", businessId);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  if (outcome === "approved") {
    await supabase.from("onboarding_tasks").update({ status: "completed", completed_at: now, completed_by: ctx.user.id }).eq("worker_id", workerId).eq("task_type", "classification_review");
  }
  refresh(workerId);
  return { ok: true, message: `Classification ${outcome}.` };
}

export async function addFreelancerAgreementAction(workerId: string, businessId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("workers.write");
  const parsed = freelancerAgreementSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("freelancer_agreements").insert({ ...parsed.data, agency_id: ctx.agencyId, business_id: uuid.parse(businessId), created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: "Agreement draft created." };
}

export async function setFreelancerAgreementStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("workers.write");
  const status = z.enum(["pending_signature", "active", "terminated"]).parse(formData.get("status"));
  const supabase = await createClient();
  const patch = status === "active" ? { status, signed_at: new Date().toISOString() } : { status };
  const { error } = await supabase.from("freelancer_agreements").update(patch).eq("id", uuid.parse(formData.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(uuid.parse(formData.get("worker_id")));
  return { ok: true, message: "Agreement updated." };
}

export async function addFreelancerRateAction(workerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("rates.write");
  const parsed = freelancerRateSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const prevDay = new Date(new Date(parsed.data.effective_from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  let open = supabase.from("freelancer_rate_agreements").update({ effective_to: prevDay }).eq("agreement_id", parsed.data.agreement_id).is("effective_to", null).lt("effective_from", parsed.data.effective_from);
  open = parsed.data.position_id ? open.eq("position_id", parsed.data.position_id) : open.is("position_id", null);
  await open;
  const { error } = await supabase.from("freelancer_rate_agreements").insert({ ...parsed.data, agency_id: ctx.agencyId, created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(workerId);
  return { ok: true, message: "Rate added." };
}
