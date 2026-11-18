import type { Metadata } from "next";
import { Download, Receipt } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, localDate } from "@/lib/time";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Invoices" };

export default async function ClientInvoicesPage() {
  const ctx = await requireClient();
  if (!ctx.capabilities.finance) return <Alert tone="warning">Your account does not have access to invoices.</Alert>;
  const supabase = await createClient();
  const { data } = await supabase.from("invoices").select("id, kind, invoice_number, status, issue_date, due_date, total, amount_paid, payments(paid_on, amount)").eq("client_id", ctx.clientId).order("issue_date", { ascending: false }).limit(200);
  const today = localDate(new Date());
  const open = (data ?? []).filter((i) => i.kind === "invoice" && ["issued", "partially_paid"].includes(i.status));
  const openAmount = open.reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0);
  const overdue = open.filter((i) => i.due_date && i.due_date < today);
  return (
    <>
      <PageHeader title="Invoices" description="Issued invoices, credit notes and payment status." />
      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Open balance" value={formatMoney(openAmount)} icon={Receipt} />
        <StatCard label="Open invoices" value={open.length} />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : "neutral"} />
      </section>
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={Receipt} title="No invoices yet" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Number</TH><TH>Date</TH><TH>Due</TH><TH className="text-right">Total</TH><TH>Payments</TH><TH>Status</TH><TH className="text-right">PDF</TH></tr></THead>
            <TBody>
              {data.map((i) => (
                <TR key={i.id}>
                  <TD className="font-medium">{i.invoice_number}{i.kind === "credit_note" && <Badge className="ml-1">Credit</Badge>}</TD>
                  <TD>{i.issue_date}</TD>
                  <TD className={i.due_date && i.due_date < today && ["issued", "partially_paid"].includes(i.status) ? "text-danger" : ""}>{i.kind === "invoice" ? i.due_date : "—"}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(Number(i.total))}</TD>
                  <TD className="text-xs text-muted-foreground">{i.payments.map((p) => `${p.paid_on}: ${formatMoney(Number(p.amount))}`).join(", ") || "—"}</TD>
                  <TD><StatusBadge status={i.status} /></TD>
                  <TD className="text-right"><a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener"><Download className="size-4" aria-hidden />PDF</a><a className="ml-3 inline-flex items-center gap-1 text-sm text-primary hover:underline" href={`/api/invoices/${i.id}/ubl`}><Download className="size-4" aria-hidden />UBL</a></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
