import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney, localDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { addManualLineAction, creditNoteAction, deleteDraftAction, emailInvoiceAction, issueInvoiceAction, recordPaymentAction, removeLineAction, updateDraftAction } from "../actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("finance.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("*, clients(id, name, billing_email, po_number_required), invoice_items(*), payments(*)").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const { data: credit } = await supabase.from("credit_notes").select("original_invoice_id, credit_invoice_id, reason").or(`original_invoice_id.eq.${id},credit_invoice_id.eq.${id}`);
  const draft = inv.status === "draft" || inv.status === "review";
  const items = [...inv.invoice_items].sort((a, b) => a.sort_order - b.sort_order);
  const open = Number(inv.total) - Number(inv.amount_paid);
  const overdue = ["issued", "partially_paid"].includes(inv.status) && inv.due_date && inv.due_date < localDate(new Date());
  return (
    <>
      <Link href="/admin/invoices" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Invoices</Link>
      <PageHeader
        title={`${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${inv.invoice_number ?? "(draft)"}`}
        description={`${inv.clients?.name}${inv.period_start ? ` · ${inv.period_start} – ${inv.period_end}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {overdue && <Badge tone="danger">Overdue</Badge>}
            <StatusBadge status={inv.status} />
            {draft && ctx.can("invoices.issue") && <ConfirmAction action={issueInvoiceAction} fields={{ id }} title="Issue this invoice?" description="A number is assigned, the content becomes immutable and the timesheets are locked. Corrections afterwards require a credit note." confirmLabel="Issue" variant="default">Issue invoice</ConfirmAction>}
            {inv.status === "draft" && ctx.can("finance.write") && <ConfirmAction action={deleteDraftAction} fields={{ id }} title="Delete this draft?" description="The timesheets become available for invoicing again." destructive variant="ghost" confirmLabel="Delete draft">Delete draft</ConfirmAction>}
            {!draft && inv.status !== "cancelled" && <Button asChild variant="secondary" size="sm"><a href={`/api/invoices/${id}/pdf`} target="_blank" rel="noopener"><Download /> PDF</a></Button>}
            {!draft && ctx.can("finance.write") && <ConfirmAction action={emailInvoiceAction} fields={{ id }} title="Email this invoice with the PDF attached?" withReason={`Recipient (empty = ${inv.clients?.billing_email ?? "billing email"})`} reasonOptional confirmLabel="Send">Email</ConfirmAction>}
            {inv.kind === "invoice" && ["issued", "partially_paid", "paid"].includes(inv.status) && ctx.can("invoices.issue") && !credit?.some((c) => c.original_invoice_id === id) && (
              <ConfirmAction action={creditNoteAction} fields={{ id }} title="Create a full credit note?" description="Issues a credit note that reverses this invoice. Re-invoice corrected amounts with a manual draft." withReason="Reason" destructive variant="ghost" confirmLabel="Create credit note">Credit note</ConfirmAction>
            )}
          </div>
        }
      />
      {inv.sent_at && <Alert tone="info" className="mb-4">Sent to {inv.sent_to} on {formatDateTime(inv.sent_at)}.</Alert>}
      {credit?.map((c) => (
        <Alert key={c.credit_invoice_id} tone="warning" className="mb-4">
          {c.original_invoice_id === id ? <>Credited: <Link className="underline" href={`/admin/invoices/${c.credit_invoice_id}`}>view credit note</Link> — {c.reason}</> : <>Credits <Link className="underline" href={`/admin/invoices/${c.original_invoice_id}`}>the original invoice</Link> — {c.reason}</>}
        </Alert>
      ))}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="overflow-hidden">
            <Table>
              <THead><tr><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Rate</TH><TH className="text-right">VAT</TH><TH className="text-right">Amount</TH>{draft && <TH />}</tr></THead>
              <TBody>
                {items.map((it) => (
                  <TR key={it.id}>
                    <TD>{it.description}</TD>
                    <TD className="text-right tabular-nums">{Number(it.quantity).toLocaleString("nl-NL", { maximumFractionDigits: 2 })} {it.unit === "hour" ? "h" : humanize(it.unit)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(Number(it.unit_price))}</TD>
                    <TD className="text-right">{Number(it.vat_rate)}%</TD>
                    <TD className="text-right tabular-nums">{formatMoney(Number(it.line_subtotal))}</TD>
                    {draft && <TD className="text-right">{ctx.can("finance.write") && <ConfirmAction action={removeLineAction} fields={{ id: it.id }} title="Remove line?" description={it.timesheet_id ? "The timesheet becomes available for invoicing again." : undefined} variant="ghost" destructive confirmLabel="Remove">×</ConfirmAction>}</TD>}
                  </TR>
                ))}
                <TR><TD colSpan={4} className="text-right">Subtotal</TD><TD className="text-right tabular-nums">{formatMoney(Number(inv.subtotal))}</TD>{draft && <TD />}</TR>
                <TR><TD colSpan={4} className="text-right">VAT</TD><TD className="text-right tabular-nums">{formatMoney(Number(inv.vat_total))}</TD>{draft && <TD />}</TR>
                <TR><TD colSpan={4} className="text-right font-semibold">Total</TD><TD className="text-right font-semibold tabular-nums">{formatMoney(Number(inv.total))}</TD>{draft && <TD />}</TR>
              </TBody>
            </Table>
          </Card>
          {draft && ctx.can("finance.write") && (
            <Card>
              <CardHeader><CardTitle>Add manual line</CardTitle></CardHeader>
              <CardContent>
                <ServerForm action={addManualLineAction.bind(null, id)} submitLabel="Add line" resetOnSuccess className="grid gap-3 sm:grid-cols-5" footerClassName="sm:col-span-5">
                  <Field name="description" label="Description" className="sm:col-span-2"><Input name="description" /></Field>
                  <Field name="quantity" label="Qty"><Input name="quantity" type="number" step="0.01" defaultValue={1} /></Field>
                  <Field name="unit" label="Unit"><NativeSelect name="unit" defaultValue="item"><option value="item">Item</option><option value="hour">Hour</option><option value="day">Day</option><option value="fixed">Fixed</option></NativeSelect></Field>
                  <Field name="unit_price" label="Price (€)"><Input name="unit_price" type="number" step="0.01" min={0} /></Field>
                  <Field name="vat_rate" label="VAT %"><Input name="vat_rate" type="number" step="0.01" defaultValue={21} /></Field>
                </ServerForm>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {draft && ctx.can("finance.write") && (
            <Card>
              <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
              <CardContent>
                <ServerForm action={updateDraftAction.bind(null, id)}>
                  <Field name="po_number" label={`PO number${inv.clients?.po_number_required ? " (required by this client)" : ""}`}><Input name="po_number" defaultValue={inv.po_number ?? ""} /></Field>
                  <Field name="notes" label="Note on invoice"><Textarea name="notes" rows={2} defaultValue={inv.notes ?? ""} /></Field>
                </ServerForm>
              </CardContent>
            </Card>
          )}
          {inv.kind === "invoice" && !draft && (
            <Card>
              <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">Paid {formatMoney(Number(inv.amount_paid))} · open <span className="font-semibold">{formatMoney(open)}</span></p>
                <ul className="space-y-1 text-sm">{inv.payments.map((p) => <li key={p.id} className="tabular-nums">{p.paid_on} · {formatMoney(Number(p.amount))} · {humanize(p.method)}{p.reference ? ` · ${p.reference}` : ""}</li>)}</ul>
                {ctx.can("payments.record") && ["issued", "partially_paid", "paid"].includes(inv.status) && (
                  <ServerForm action={recordPaymentAction.bind(null, id)} submitLabel="Record payment" resetOnSuccess>
                    <div className="grid grid-cols-2 gap-3">
                      <Field name="amount" label="Amount (€)"><Input name="amount" type="number" step="0.01" defaultValue={open > 0 ? open.toFixed(2) : ""} /></Field>
                      <Field name="paid_on" label="Date"><Input name="paid_on" type="date" defaultValue={localDate(new Date())} /></Field>
                    </div>
                    <Field name="method" label="Method"><NativeSelect name="method" defaultValue="bank_transfer">{["bank_transfer", "direct_debit", "card", "cash", "offset", "other"].map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</NativeSelect></Field>
                    <Field name="reference" label="Reference"><Input name="reference" /></Field>
                  </ServerForm>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
