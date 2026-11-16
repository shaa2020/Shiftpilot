"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { optionalText } from "@/lib/validation/agency";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

const openingSchema = z.object({
  title: z.string().trim().min(3, "Enter a title").max(200),
  position_id: uuid.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  industry_id: uuid.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  engagement_types: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(["employee", "freelancer"])).min(1, "Choose at least one pathway")),
  location_city: optionalText(100),
  description: z.string().trim().min(20, "Describe the job (at least 20 characters)").max(10000),
  requirements_text: optionalText(5000),
  hours_indication: optionalText(200),
  pay_indication: optionalText(200),
  closes_at: z.string().or(z.literal("")).transform((v) => (v === "" ? null : new Date(v).toISOString())).optional(),
});

export async function createOpeningAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("recruitment.write");
  const parsed = openingSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const slug = `${slugify(parsed.data.title)}-${Math.random().toString(36).slice(2, 6)}`;
  const { error } = await supabase.from("job_openings").insert({ ...parsed.data, slug, agency_id: ctx.agencyId, created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/admin/recruitment");
  return { ok: true, message: "Opening saved as draft." };
}

export async function setOpeningStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("recruitment.write");
  const status = z.enum(["draft", "published", "closed"]).parse(fd.get("status"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_openings")
    .update({ status, ...(status === "published" ? { published_at: new Date().toISOString() } : {}) })
    .eq("id", uuid.parse(fd.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/recruitment");
  revalidatePath("/recruitment", "layout");
  return { ok: true, message: status === "published" ? "Published on the careers site." : `Opening ${status}.` };
}

const STATUSES = ["new", "screening", "interview", "assessment", "offer", "onboarding", "hired", "rejected", "withdrawn"] as const;

export async function setApplicationStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("recruitment.write");
  const status = z.enum(STATUSES).parse(fd.get("status"));
  const reason = String(fd.get("reason") ?? "").trim();
  if (status === "rejected" && reason.length < 3) return { ok: false, message: "Give a reason for the rejection." };
  const supabase = await createClient();
  const { error } = await supabase.from("applications").update({ status, rejection_reason: status === "rejected" ? reason : null }).eq("id", uuid.parse(fd.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/recruitment", "layout");
  return { ok: true, message: `Status changed to ${status}.` };
}

export async function assignRecruiterAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("recruitment.write");
  const supabase = await createClient();
  const { error } = await supabase.from("applications").update({ assigned_recruiter_id: uuid.parse(fd.get("recruiter_id")) }).eq("id", uuid.parse(fd.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/recruitment", "layout");
  return { ok: true, message: "Recruiter assigned." };
}

const interviewSchema = z.object({
  scheduled_at: z.string().min(1, "Choose a date and time").transform((v) => new Date(v).toISOString()),
  duration_minutes: z.coerce.number().int().min(5).max(480),
  mode: z.enum(["in_person", "video", "phone"]),
  location_or_link: optionalText(500),
});

export async function scheduleInterviewAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("recruitment.write");
  const parsed = interviewSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("interviews").insert({ ...parsed.data, agency_id: ctx.agencyId, application_id: uuid.parse(applicationId), interviewer_id: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  await supabase.from("applications").update({ status: "interview" }).eq("id", applicationId).in("status", ["new", "screening"]);
  revalidatePath(`/admin/recruitment/applications/${applicationId}`);
  return { ok: true, message: "Interview scheduled." };
}

export async function recordInterviewOutcomeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("recruitment.write");
  const outcome = z.enum(["positive", "neutral", "negative", "no_show", "cancelled"]).parse(fd.get("outcome"));
  const notes = String(fd.get("reason") ?? "").trim() || null;
  const supabase = await createClient();
  const patch = outcome === "no_show" || outcome === "cancelled" ? { status: outcome, notes } : { status: "completed", outcome, notes };
  const { data, error } = await supabase.from("interviews").update(patch).eq("id", uuid.parse(fd.get("id"))).select("application_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/admin/recruitment/applications/${data[0].application_id}`);
  return { ok: true, message: "Interview updated." };
}

const screeningSchema = z.object({
  criterion: z.string().trim().min(2, "Enter the criterion").max(200),
  result: z.enum(["pass", "fail", "needs_information"]),
  score: z.union([z.literal(""), z.coerce.number().int().min(0).max(100)]).transform((v) => (v === "" ? null : v)).optional(),
  notes: optionalText(2000),
});

export async function addScreeningAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("recruitment.write");
  const parsed = screeningSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("screening_records").insert({ ...parsed.data, agency_id: ctx.agencyId, application_id: uuid.parse(applicationId), assessed_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  await supabase.from("applications").update({ status: "screening" }).eq("id", applicationId).eq("status", "new");
  revalidatePath(`/admin/recruitment/applications/${applicationId}`);
  return { ok: true, message: "Screening recorded." };
}

export async function addApplicationNoteAction(applicationId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("recruitment.read");
  const body = z.string().trim().min(1, "Write a note").max(10000).safeParse(fd.get("body"));
  if (!body.success) return { errors: { body: body.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.from("internal_notes").insert({ agency_id: ctx.agencyId, subject_type: "application", subject_id: uuid.parse(applicationId), body: body.data, created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/recruitment/applications/${applicationId}`);
  return { ok: true, message: "Note added." };
}

/** Hire: create the worker record from the application (onboarding starts). */
export async function convertToWorkerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("recruitment.write", "workers.write");
  const id = uuid.parse(fd.get("id"));
  const engagement = z.enum(["employee", "freelancer"]).parse(fd.get("engagement"));
  const supabase = await createClient();
  const { data: app } = await supabase.from("applications").select("*").eq("id", id).single();
  if (!app) return { ok: false, message: "Application not found." };
  if (app.worker_id) return { ok: false, message: "A worker record already exists for this application." };
  const { data: worker, error } = await supabase
    .from("workers")
    .insert({ agency_id: ctx.agencyId, engagement_type: engagement, first_name: app.first_name, last_name: app.last_name, email: app.email, phone: app.phone, city: app.city, created_by: ctx.user.id, status: "invited" })
    .select("id")
    .single();
  if (error || !worker) return { ok: false, message: dbErrorMessage(error) };
  const { error: uErr } = await supabase.from("applications").update({ worker_id: worker.id, status: "onboarding" }).eq("id", id);
  if (uErr) return { ok: false, message: dbErrorMessage(uErr) };
  redirect(`/admin/workers/${worker.id}`);
}
