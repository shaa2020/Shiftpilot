"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadInvoiceForPdf } from "@/lib/finance/load";
import { renderInvoicePdf, money } from "@/lib/finance/invoice-pdf";
import { escapeHtml, sendEmail } from "@/lib/integrations/email";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";

const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/admin/invoices");
  if (id) revalidatePath(`/admin/invoices/${id}`);
};

export async function generateInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("finance.write");
  const parsed = z.object({
    client_id: z.string().uuid("Choose a client"),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start"),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end"),
  }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_client_invoice", { p_client_id: parsed.data.client_id, p_period_start: parsed.data.period_start, p_period_end: parsed.data.period_end });
  if (error || !data) return { message: dbErrorMessage(error) };
  redirect(`/admin/invoices/${data}`);
}

export async function updateDraftAction(invoiceId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("finance.write");
  const po = String(fd.get("po_number") ?? "").trim() || null;
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update({ po_number: po, notes }).eq("id", uuid.parse(invoiceId)).in("status", ["draft", "review"]);
  if (error) return { message: dbErrorMessage(error) };
  refresh(invoiceId);
  return { ok: true, message: "Draft saved." };
}

export async function addManualLineAction(invoiceId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("finance.write");
  const parsed = z.object({
    description: z.string().trim().min(2, "Describe the line").max(300),
    quantity: z.coerce.number().positive().max(100000),
    unit: z.enum(["hour", "item", "day", "fixed"]),
    unit_price: z.coerce.number().min(0).max(1000000),
    vat_rate: z.coerce.number().min(0).max(100),
  }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_items").insert({ ...parsed.data, agency_id: ctx.agencyId, invoice_id: uuid.parse(invoiceId), sort_order: 10000 });
  if (error) return { message: dbErrorMessage(error) };
  refresh(invoiceId);
  return { ok: true, message: "Line added." };
}

export async function removeLineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("finance.write");
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoice_items").delete().eq("id", uuid.parse(fd.get("id"))).select("invoice_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  refresh(data[0].invoice_id);
  return { ok: true, message: "Line removed." };
}

export async function deleteDraftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("finance.write");
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").delete().eq("id", uuid.parse(fd.get("id"))).eq("status", "draft");
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/invoices");
  redirect("/admin/invoices");
}

export async function issueInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("invoices.issue");
  const id = uuid.parse(fd.get("id"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_invoice", { p_invoice_id: id });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refresh(id);
  return { ok: true, message: `Invoice ${data} issued. The timesheets are now locked.` };
}

export async function emailInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("finance.write");
  const id = uuid.parse(fd.get("id"));
  const inv = await loadInvoiceForPdf(id);
  if (!inv) return { ok: false, message: "Only issued invoices can be sent." };
  const to = String(fd.get("reason") ?? "").trim() || inv.client_billing_email;
  if (!to || !z.string().email().safeParse(to).success) return { ok: false, message: "Enter a valid billing email address." };
  const pdf = await renderInvoicePdf(inv);
  const label = inv.kind === "credit_note" ? "Credit note" : "Invoice";
  const res = await sendEmail({
    to,
    subject: `${label} ${inv.invoice_number} from ${inv.billing_snapshot.agency.name}`,
    text: `Dear ${inv.billing_snapshot.client.name},\n\nPlease find attached ${label.toLowerCase()} ${inv.invoice_number} for ${money(inv.total)}.${inv.kind === "invoice" ? ` Payment is due by ${inv.due_date}.` : ""}\n\nKind regards,\n${inv.billing_snapshot.agency.name}`,
    html: `<p>Dear ${escapeHtml(inv.billing_snapshot.client.name)},</p><p>Please find attached ${label.toLowerCase()} <strong>${escapeHtml(inv.invoice_number)}</strong> for <strong>${escapeHtml(money(inv.total))}</strong>.${inv.kind === "invoice" ? ` Payment is due by ${escapeHtml(inv.due_date ?? "")}.` : ""}</p><p>Kind regards,<br>${escapeHtml(inv.billing_snapshot.agency.name)}</p>`,
    idempotencyKey: `invoice-email-${id}-${to}`,
    attachments: [{ filename: `${inv.invoice_number}.pdf`, content: pdf }],
  });
  if (res.status === "not_configured") return { ok: false, message: "Email delivery is awaiting configuration (Resend). Download the PDF and send it yourself." };
  if (res.status === "failed") return { ok: false, message: `The email could not be sent: ${res.error}` };
  const supabase = await createClient();
  await supabase.rpc("record_invoice_sent", { p_invoice_id: id, p_sent_to: to });
  refresh(id);
  return { ok: true, message: `Sent to ${to}.` };
}

export async function recordPaymentAction(invoiceId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("payments.record");
  const parsed = z.object({
    amount: z.coerce.number().positive("Enter a positive amount").max(10000000),
    paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
    method: z.enum(["bank_transfer", "direct_debit", "card", "cash", "offset", "other"]),
    reference: z.string().trim().max(120).optional(),
  }).safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({ ...parsed.data, reference: parsed.data.reference || null, agency_id: ctx.agencyId, invoice_id: uuid.parse(invoiceId), recorded_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  refresh(invoiceId);
  return { ok: true, message: "Payment recorded." };
}

export async function creditNoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("invoices.issue");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_credit_note", { p_invoice_id: uuid.parse(fd.get("id")), p_reason: String(fd.get("reason") ?? "") });
  if (error || !data) return { ok: false, message: dbErrorMessage(error) };
  refresh();
  redirect(`/admin/invoices/${data}`);
}
