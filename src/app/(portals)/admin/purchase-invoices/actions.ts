"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type ActionState } from "@/lib/actions/state";

export async function reviewPurchaseInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("purchase_invoices.approve");
  const approve = fd.get("approve") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_freelancer_invoice", { p_invoice_id: z.string().uuid().parse(fd.get("id")), p_approve: approve, p_note: String(fd.get("reason") ?? "") });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/purchase-invoices");
  return { ok: true, message: approve ? "Approved for payment." : "Rejected; the freelancer was notified." };
}

export async function markPaidAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("payments.record");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_freelancer_invoice_paid", { p_invoice_id: z.string().uuid().parse(fd.get("id")), p_paid_on: new Date().toISOString().slice(0, 10), p_reference: String(fd.get("reason") ?? "") || "" });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/purchase-invoices");
  return { ok: true, message: "Marked as paid." };
}
