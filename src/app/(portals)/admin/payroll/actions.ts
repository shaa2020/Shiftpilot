"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

export async function createPayrollPeriodAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("payroll.export");
  const parsed = z.object({
    name: z.string().trim().min(2, "Name the period").max(80),
    frequency: z.enum(["weekly", "four_weekly", "monthly"]),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start"),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end"),
  }).refine((d) => d.period_end >= d.period_start, { path: ["period_end"], message: "End must be after start" }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("payroll_periods").insert({ ...parsed.data, agency_id: ctx.agencyId });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/admin/payroll");
  return { ok: true, message: "Payroll period created." };
}

export async function generatePayrollExportAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("payroll.export");
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_payroll_export", { p_payroll_period_id: z.string().uuid().parse(fd.get("id")), p_format: "csv" });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/payroll");
  return { ok: true, message: "Payroll export generated. Download the CSV for your payroll provider." };
}

export async function closePayrollPeriodAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("payroll.export");
  const supabase = await createClient();
  const { error } = await supabase.from("payroll_periods").update({ status: "closed" }).eq("id", z.string().uuid().parse(fd.get("id"))).eq("status", "exported");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/payroll");
  return { ok: true, message: "Period closed." };
}
