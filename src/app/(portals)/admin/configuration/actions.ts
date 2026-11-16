"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { optionalText } from "@/lib/validation/agency";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const bool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
const done = (msg: string): ActionState => {
  revalidatePath("/admin/configuration", "layout");
  return { ok: true, message: msg };
};

const industrySchema = z.object({ name: z.string().trim().min(2).max(80), description: optionalText(500) });
export async function addIndustryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("industries.manage");
  const parsed = industrySchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("industries").insert({ ...parsed.data, agency_id: ctx.agencyId, slug: slugify(parsed.data.name), sort_order: 1000 });
  return error ? { message: dbErrorMessage(error) } : done("Industry added.");
}

const categorySchema = z.object({ industry_id: uuid, name: z.string().trim().min(2).max(80) });
export async function addCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("industries.manage");
  const parsed = categorySchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("job_categories").insert({ ...parsed.data, agency_id: ctx.agencyId });
  return error ? { message: dbErrorMessage(error) } : done("Category added.");
}

const positionSchema = z.object({
  industry_id: uuid,
  category_id: uuid.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
  name: z.string().trim().min(2, "Enter the position name").max(120),
  description: optionalText(2000),
  default_dress_code: optionalText(300),
  safety_requirements: optionalText(1000),
  is_regulated: bool,
  allows_freelancers: bool,
});
export async function addPositionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("industries.manage");
  const parsed = positionSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const { error } = await supabase.from("job_positions").insert({ ...parsed.data, agency_id: ctx.agencyId });
  return error ? { message: dbErrorMessage(error) } : done("Position added.");
}
export async function updatePositionAction(positionId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("industries.manage");
  const parsed = positionSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const { error } = await supabase.from("job_positions").update(parsed.data).eq("id", uuid.parse(positionId));
  return error ? { message: dbErrorMessage(error) } : done("Position saved.");
}

const simpleSchema = z.object({ name: z.string().trim().min(2).max(120), category: optionalText(80), issuing_body: optionalText(120), description: optionalText(500),
  validity_months: z.union([z.literal(""), z.coerce.number().int().min(1).max(240)]).transform((v) => (v === "" ? null : v)).optional(),
  is_regulated: bool });
export async function addCatalogItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("industries.manage");
  const table = z.enum(["skills", "certificates", "qualifications"]).parse(fd.get("table"));
  const parsed = simpleSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const row =
    table === "skills" ? { name: d.name, category: d.category }
    : table === "certificates" ? { name: d.name, issuing_body: d.issuing_body, validity_months: d.validity_months, is_regulated: d.is_regulated }
    : { name: d.name, description: d.description, is_regulated: d.is_regulated };
  const { error } = await supabase.from(table).insert({ ...row, agency_id: ctx.agencyId } as never);
  return error ? { message: dbErrorMessage(error) } : done("Added.");
}

export async function setConfigStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("industries.manage");
  const table = z.enum(["industries", "job_categories", "job_positions", "skills", "certificates", "qualifications"]).parse(fd.get("table"));
  const status = z.enum(["active", "archived"]).parse(fd.get("status"));
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ status }).eq("id", uuid.parse(fd.get("id")));
  return error ? { ok: false, message: dbErrorMessage(error) } : done(status === "archived" ? "Archived." : "Restored.");
}

const requirementSchema = z
  .object({
    requirement_type: z.enum(["skill", "qualification", "certificate", "language", "experience", "safety", "engagement"]),
    skill_id: uuid.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    qualification_id: uuid.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    certificate_id: uuid.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    language_code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    min_language_level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    min_experience_months: z.union([z.literal(""), z.coerce.number().int().min(0).max(600)]).transform((v) => (v === "" ? null : v)).optional(),
    engagement_type: z.enum(["employee", "freelancer"]).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional(),
    description: optionalText(500),
    is_mandatory: bool,
  })
  .superRefine((d, ctx) => {
    const need: Record<string, keyof typeof d> = { skill: "skill_id", qualification: "qualification_id", certificate: "certificate_id", language: "language_code", experience: "min_experience_months", safety: "description", engagement: "engagement_type" };
    const key = need[d.requirement_type];
    if (d[key] === null || d[key] === undefined) ctx.addIssue({ code: "custom", path: [key], message: "This value is required for the selected requirement type" });
  });

export async function addRequirementAction(positionId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("industries.manage");
  const parsed = requirementSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please complete the requirement." };
  const d = parsed.data;
  // Store only the column relevant to the type.
  const row = {
    requirement_type: d.requirement_type, is_mandatory: d.is_mandatory, description: d.description,
    skill_id: d.requirement_type === "skill" ? d.skill_id : null,
    qualification_id: d.requirement_type === "qualification" ? d.qualification_id : null,
    certificate_id: d.requirement_type === "certificate" ? d.certificate_id : null,
    language_code: d.requirement_type === "language" ? d.language_code : null,
    min_language_level: d.requirement_type === "language" ? d.min_language_level : null,
    min_experience_months: d.requirement_type === "experience" ? d.min_experience_months : null,
    engagement_type: d.requirement_type === "engagement" ? d.engagement_type : null,
  };
  const supabase = await createClient();
  const { error } = await supabase.from("position_requirements").insert({ ...row, agency_id: ctx.agencyId, position_id: uuid.parse(positionId) });
  return error ? { message: dbErrorMessage(error) } : done("Requirement added.");
}

export async function removeRequirementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("industries.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("position_requirements").delete().eq("id", uuid.parse(fd.get("id")));
  return error ? { ok: false, message: dbErrorMessage(error) } : done("Requirement removed.");
}
