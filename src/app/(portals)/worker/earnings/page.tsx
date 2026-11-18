import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, localDate } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { submitFreelancerInvoiceAction } from "./actions";

export const metadata: Metadata = { title: "Earnings" };

export default async function EarningsPage() {
  const ctx = await requireWorker();
  const supabase = await createClient();
  if (ctx.engagementType === "employee") {
    const [{ data: ts }, { data: payslips }] = await Promise.all([
      supabase.from("timesheets").select("id, scheduled_start, worked_minutes, status, shifts(title)").eq("worker_id", ctx.workerId).in("status", ["agency_approved", "locked"]).order("scheduled_start", { ascending: false }).limit(100),
      supabase.from("payslips").select("id, net_amount, paid_on, document_id, payroll_periods(name, period_start, period_end)").eq("worker_id", ctx.workerId).order("created_at", { ascending: false }),
    ]);
    const total = (ts ?? []).reduce((a, t) => a + (t.worked_minutes ?? 0), 0);
    return (
      <>
        <PageHeader title="Earnings" description="Approved hours are paid through payroll according to your employment contract." />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Approved hours</CardTitle><CardDescription>{hoursLabel(total)} h across the last {ts?.length ?? 0} approved shifts</CardDescription></CardHeader>
            <CardContent>
              {!ts?.length ? <EmptyState icon={Wallet} title="No approved hours yet" /> : (
                <ul className="divide-y divide-border text-sm">{ts.map((t) => <li key={t.id} className="flex justify-between py-2"><span>{formatDate(t.scheduled_start)} · {t.shifts?.title}</span><span className="tabular-nums">{hoursLabel(t.worked_minutes ?? 0)} h</span></li>)}</ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Payslips</CardTitle><CardDescription>Provided by payroll after each pay period.</CardDescription></CardHeader>
            <CardContent>
              {!payslips?.length ? <p className="text-sm text-muted-foreground">No payslips available yet.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {payslips.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{p.payroll_periods?.name}{p.paid_on ? ` · paid ${p.paid_on}` : ""}</span><a className="text-primary hover:underline" href={`/api/documents/${p.document_id}`}>Download</a></li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const [{ data: open }, { data: invoices }, { data: biz }] = await Promise.all([
    supabase.rpc("my_uninvoiced_timesheets", { p_worker_id: ctx.workerId }),
    supabase.from("freelancer_invoices").select("id, supplier_invoice_number, invoice_date, total, status, review_note, paid_on").eq("worker_id", ctx.workerId).order("created_at", { ascending: false }),
    supabase.from("freelancer_businesses").select("trade_name, vat_liable, small_business_scheme").eq("worker_id", ctx.workerId).maybeSingle(),
  ]);
  const defaultVat = biz?.small_business_scheme || !biz?.vat_liable ? 0 : 21;
  return (
    <>
      <PageHeader title="Earnings" description="Invoice the agency for your approved assignments. This is separate from payroll." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Approved, not yet invoiced</CardTitle><CardDescription>Amounts use the commercial rate agreed for each assignment.</CardDescription></CardHeader>
          <CardContent>
            {!open?.length ? <EmptyState icon={Wallet} title="Nothing to invoice right now" /> : (
              <ServerForm action={submitFreelancerInvoiceAction} submitLabel="Submit invoice" resetOnSuccess>
                <ul className="divide-y divide-border text-sm">
                  {open.map((t) => (
                    <li key={t.timesheet_id} className="flex items-center gap-3 py-2">
                      <input type="checkbox" name="timesheet_ids" value={t.timesheet_id} defaultChecked className="size-4 accent-primary" aria-label={`Include ${t.shift_title}`} />
                      <span className="flex-1">{formatDate(t.scheduled_start)} · {t.shift_title} · {hoursLabel(t.worked_minutes)} h × {t.hourly_amount != null ? formatMoney(Number(t.hourly_amount)) : "fixed fee"}</span>
                      <span className="tabular-nums">{formatMoney(Number(t.amount))}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                  <Field name="supplier_invoice_number" label="Your invoice number" required><Input name="supplier_invoice_number" /></Field>
                  <Field name="invoice_date" label="Invoice date" required><Input name="invoice_date" type="date" defaultValue={localDate(new Date())} /></Field>
                  <Field name="vat_rate" label="VAT %" hint={biz?.small_business_scheme ? "You use the small business scheme (KOR)." : "Check the rate with your tax adviser."}><Input name="vat_rate" type="number" step="0.01" min={0} max={100} defaultValue={defaultVat} /></Field>
                  <Field name="payee_name" label="Account holder" required><Input name="payee_name" defaultValue={biz?.trade_name ?? ""} /></Field>
                  <Field name="payee_iban" label="IBAN" required className="sm:col-span-2"><Input name="payee_iban" autoComplete="off" /></Field>
                </div>
              </ServerForm>
            )}
            {!biz && <Alert tone="warning" className="mt-3">Register your business details with the agency before invoicing.</Alert>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>My invoices</CardTitle></CardHeader>
          <CardContent className="px-0">
            {!invoices?.length ? <p className="px-5 text-sm text-muted-foreground">No invoices submitted yet.</p> : (
              <Table>
                <THead><tr><TH>Invoice</TH><TH className="text-right">Total</TH><TH>Status</TH></tr></THead>
                <TBody>{invoices.map((i) => <TR key={i.id}><TD>{i.supplier_invoice_number}<p className="text-xs text-muted-foreground">{i.invoice_date}{i.paid_on ? ` · paid ${i.paid_on}` : ""}</p></TD><TD className="text-right tabular-nums">{formatMoney(Number(i.total))}</TD><TD><StatusBadge status={i.status} />{i.review_note && <p className="text-xs text-muted-foreground">{i.review_note}</p>}</TD></TR>)}</TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
