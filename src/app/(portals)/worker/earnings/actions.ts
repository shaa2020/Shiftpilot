"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isValidIban } from "@/lib/validation/agency";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const schema = z.object({
  supplier_invoice_number: z.string().trim().min(1, "Enter your invoice number").max(50),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  vat_rate: z.coerce.number().min(0).max(100),
  payee_name: z.string().trim().min(2, "Enter the account holder").max(120),
  payee_iban: z.string().trim().refine(isValidIban, "This IBAN is not valid"),
  timesheet_ids: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().uuid()).min(1, "Select at least one shift")),
});

export async function submitFreelancerInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireWorker();
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_freelancer_invoice", {
    p_worker_id: ctx.workerId, p_supplier_invoice_number: d.supplier_invoice_number, p_invoice_date: d.invoice_date,
    p_timesheet_ids: d.timesheet_ids, p_vat_rate: d.vat_rate, p_payee_iban: d.payee_iban, p_payee_name: d.payee_name,
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/worker/earnings");
  return { ok: true, message: "Invoice submitted. You will be notified when it is approved and paid." };
}
