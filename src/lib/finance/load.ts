import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PdfInvoice } from "./invoice-pdf";

/** Loads an issued invoice as the current user (RLS decides visibility). */
export async function loadInvoiceForPdf(id: string): Promise<(PdfInvoice & { agency_id: string; client_billing_email: string | null }) | null> {
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("agency_id, kind, invoice_number, issue_date, due_date, period_start, period_end, po_number, notes, currency, subtotal, vat_total, total, billing_snapshot, status, invoice_items(description, quantity, unit, unit_price, vat_rate, line_subtotal, sort_order)")
    .eq("id", id)
    .maybeSingle();
  if (!inv || !inv.invoice_number || !inv.issue_date || ["draft", "review", "cancelled"].includes(inv.status)) return null;
  const snap = inv.billing_snapshot as unknown as PdfInvoice["billing_snapshot"] & { client: { email?: string | null } };
  return {
    agency_id: inv.agency_id,
    client_billing_email: snap.client.email ?? null,
    kind: inv.kind as PdfInvoice["kind"], invoice_number: inv.invoice_number, issue_date: inv.issue_date, due_date: inv.due_date,
    period_start: inv.period_start, period_end: inv.period_end, po_number: inv.po_number, notes: inv.notes, currency: inv.currency,
    subtotal: Number(inv.subtotal), vat_total: Number(inv.vat_total), total: Number(inv.total), billing_snapshot: snap,
    items: [...inv.invoice_items].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), vat_rate: Number(i.vat_rate), line_subtotal: Number(i.line_subtotal ?? 0) })),
  };
}
