"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const opt = <T extends z.ZodTypeAny>(s: T) => s.or(z.literal("")).transform((v) => (v === "" ? null : v)).optional();
const refresh = (clientId: string) => revalidatePath(`/admin/clients/${clientId}`);

const cardSchema = z.object({
  name: z.string().trim().min(2, "Name the rate card").max(120),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date"),
  contract_id: opt(uuid),
});

export async function createRateCardAction(clientId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("rates.write");
  const parsed = cardSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("client_rate_cards").insert({ ...parsed.data, agency_id: ctx.agencyId, client_id: uuid.parse(clientId), created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(clientId);
  return { ok: true, message: "Draft rate card created. Add rules, then approve it." };
}

const ruleSchema = z
  .object({
    rule_kind: z.enum(["base", "weekend", "night", "public_holiday", "overtime"]),
    hourly_rate: opt(z.coerce.number().min(0).max(1000)),
    multiplier: opt(z.coerce.number().positive().max(5)),
    position_id: opt(uuid),
    location_id: opt(uuid),
    days_of_week: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int().min(1).max(7))),
    time_from: opt(z.string().regex(/^\d{2}:\d{2}$/)),
    time_to: opt(z.string().regex(/^\d{2}:\d{2}$/)),
  })
  .superRefine((d, ctx) => {
    if (d.rule_kind === "base" && d.hourly_rate == null) ctx.addIssue({ code: "custom", path: ["hourly_rate"], message: "A base rule needs an hourly rate" });
    if ((d.hourly_rate == null) === (d.multiplier == null)) ctx.addIssue({ code: "custom", path: ["multiplier"], message: "Enter either an hourly rate or a multiplier" });
    if ((d.time_from == null) !== (d.time_to == null)) ctx.addIssue({ code: "custom", path: ["time_to"], message: "Enter both times" });
  });

export async function addRateRuleAction(clientId: string, cardId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("rates.write");
  const parsed = ruleSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the rule." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("client_rate_rules").insert({
    agency_id: ctx.agencyId, rate_card_id: uuid.parse(cardId), rule_kind: d.rule_kind, hourly_rate: d.hourly_rate, multiplier: d.multiplier,
    position_id: d.position_id, location_id: d.location_id, days_of_week: d.days_of_week.length ? d.days_of_week : null, time_from: d.time_from, time_to: d.time_to,
  });
  if (error) return { message: dbErrorMessage(error) };
  refresh(clientId);
  return { ok: true, message: "Rule added." };
}

export async function removeRateRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("rates.write");
  const supabase = await createClient();
  const { error } = await supabase.from("client_rate_rules").delete().eq("id", uuid.parse(fd.get("id")));
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(uuid.parse(fd.get("client_id")));
  return { ok: true, message: "Rule removed." };
}

/** Activates a draft card and supersedes the previously active card from the day before. */
export async function approveRateCardAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("rates.write");
  const cardId = uuid.parse(fd.get("id"));
  const clientId = uuid.parse(fd.get("client_id"));
  const supabase = await createClient();
  const { data: card } = await supabase.from("client_rate_cards").select("effective_from, status, client_rate_rules(rule_kind)").eq("id", cardId).single();
  if (!card || card.status !== "draft") return { ok: false, message: "Only draft rate cards can be approved." };
  if (!card.client_rate_rules.some((r) => r.rule_kind === "base")) return { ok: false, message: "Add at least one base rate before approving." };
  const prevDay = new Date(new Date(card.effective_from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const { data: active } = await supabase.from("client_rate_cards").select("id, effective_from").eq("client_id", clientId).eq("status", "active");
  for (const a of active ?? []) {
    if (a.effective_from > prevDay) return { ok: false, message: "An active rate card starts on or after this date. Choose a later start date." };
    const { error } = await supabase.from("client_rate_cards").update({ status: "superseded", effective_to: prevDay }).eq("id", a.id);
    if (error) return { ok: false, message: dbErrorMessage(error) };
  }
  const { error } = await supabase.from("client_rate_cards").update({ status: "active", approved_by: ctx.user.id, approved_at: new Date().toISOString() }).eq("id", cardId);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(clientId);
  return { ok: true, message: "Rate card approved and active. Rules are now locked." };
}
