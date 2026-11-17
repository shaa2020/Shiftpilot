"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, zodErrors, type ActionState } from "@/lib/actions/state";
import { localDate } from "@/lib/time";

const done = (message: string): ActionState => {
  revalidatePath("/admin/compliance");
  return { ok: true, message };
};

export async function decideReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("compliance.review");
  const parsed = z.object({
    id: z.string().uuid(),
    outcome: z.enum(["approved", "restricted", "rejected"]),
    rationale: z.string().trim().min(10, "Explain the decision (at least 10 characters)").max(2000),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
    max_hours_per_week: z.string().regex(/^\d{0,3}$/).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const d = parsed.data;
  const restrictions = d.outcome === "restricted" && d.max_hours_per_week ? { max_hours_per_week: Number(d.max_hours_per_week) } : {};
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_compliance_review", { p_review_id: d.id, p_outcome: d.outcome, p_rationale: d.rationale, p_valid_until: d.valid_until || undefined, p_restrictions: restrictions });
  if (error) return { message: dbErrorMessage(error) };
  return done("Decision recorded.");
}

export async function requestPositionReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("compliance.review");
  const parsed = z.object({ worker_id: z.string().uuid("Choose a worker"), position_id: z.string().uuid("Choose a position"), notes: z.string().max(2000).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("compliance_reviews").insert({
    agency_id: ctx.agencyId, review_type: "regulated_position", worker_id: parsed.data.worker_id, position_id: parsed.data.position_id,
    requested_by: ctx.user.id, questionnaire: parsed.data.notes ? { notes: parsed.data.notes } : {},
  });
  if (error) return { message: dbErrorMessage(error) };
  return done("Review opened.");
}

const ruleSchema = z.object({
  rule_key: z.string().trim().regex(/^[a-z0-9_.]{3,80}$/, "Use lowercase letters, digits, dots and underscores"),
  category: z.enum(["work_eligibility", "classification", "working_time", "minimum_wage", "equal_treatment", "certification", "health_safety", "registration", "other"]),
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(4000),
  parameters: z.string().trim().transform((v, c) => {
    if (!v) return {};
    try {
      const o = JSON.parse(v);
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {}
    c.addIssue({ code: "custom", message: "Enter a JSON object, e.g. {\"max_shift_minutes\": 720}" });
    return z.NEVER;
  }),
  severity: z.enum(["blocking", "warning", "informational"]),
  source_reference: z.string().trim().min(3, "Cite the authoritative source").max(1000),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
});

export async function createRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("compliance.review");
  const parsed = ruleSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { data: last } = await supabase.from("compliance_rules").select("version").eq("agency_id", ctx.agencyId).eq("rule_key", parsed.data.rule_key).order("version", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("compliance_rules").insert({ ...parsed.data, parameters: parsed.data.parameters as never, agency_id: ctx.agencyId, version: (last?.version ?? 0) + 1, status: "draft", created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  return done(`Draft version ${(last?.version ?? 0) + 1} created. Activate it after review.`);
}

export async function setRuleStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("compliance.review");
  const id = z.string().uuid().parse(fd.get("id"));
  const status = z.enum(["active", "retired"]).parse(fd.get("status"));
  const supabase = await createClient();
  if (status === "active") {
    const { data: rule } = await supabase.from("compliance_rules").select("rule_key, effective_from").eq("id", id).single();
    if (!rule) return { message: "Rule not found." };
    // Close the previous active version the day before this one takes effect.
    const prevEnd = localDate(new Date(new Date(`${rule.effective_from}T12:00:00Z`).getTime() - 86400000));
    const closed = await supabase.from("compliance_rules").update({ effective_to: prevEnd }).eq("agency_id", ctx.agencyId).eq("rule_key", rule.rule_key).eq("status", "active").is("effective_to", null).neq("id", id);
    if (closed.error) return { message: "The previous version starts on or after this one; pick a later effective date." };
    const { error } = await supabase.from("compliance_rules").update({ status: "active", approved_by: ctx.user.id, approved_at: new Date().toISOString() }).eq("id", id).eq("status", "draft");
    if (error) return { message: dbErrorMessage(error) };
    return done("Rule activated.");
  }
  const { error } = await supabase.from("compliance_rules").update({ status: "retired", effective_to: localDate(new Date()) }).eq("id", id);
  if (error) return { message: dbErrorMessage(error) };
  return done("Rule retired.");
}
