import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, localDate, monthRange } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ListFilters } from "@/components/ui/list-filters";
import { generateInvoiceAction } from "./actions";

export const metadata: Metadata = { title: "Invoices" };
const STATUSES = ["draft", "review", "issued", "partially_paid", "paid", "credited", "cancelled"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; overdue?: string }> }) {
  const ctx = await requireStaff("finance.read");
  const { status, overdue } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("invoices").select("id, kind, invoice_number, status, issue_date, due_date, total, amount_paid, period_start, period_end, clients(name)").eq("agency_id", ctx.agencyId).order("created_at", { ascending: false }).limit(300);
  if (status && STATUSES.includes(status)) q = q.eq("status", status);
  const today = localDate(new Date());
  if (overdue) q = q.in("status", ["issued", "partially_paid"]).lt("due_date", today);
  const [{ data }, { data: clients }] = await Promise.all([q, supabase.from("clients").select("id, name").eq("agency_id", ctx.agencyId).neq("status", "archived").order("name")]);
  const prev = monthRange(new Date(new Date().setUTCDate(0)));
  return (
    <>
      <PageHeader title="Invoices" description="Client invoices generated from approved timesheets and their confirmed rates." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <ListFilters showSearch={false} selects={[{ name: "status", label: "Status", value: status, options: STATUSES.map((s) => [s, humanize(s)]) }]} />
          <Card className="overflow-hidden">
            {!data?.length ? <EmptyState icon={Receipt} title="No invoices" className="m-5" /> : (
              <Table>
                <THead><tr><TH>Number</TH><TH>Client</TH><TH>Period</TH><TH>Due</TH><TH className="text-right">Total</TH><TH className="text-right">Open</TH><TH>Status</TH></tr></THead>
                <TBody>
                  {data.map((i) => {
                    const isOverdue = ["issued", "partially_paid"].includes(i.status) && !!i.due_date && i.due_date < today;
                    return (
                      <TR key={i.id}>
                        <TD><Link href={`/admin/invoices/${i.id}`} className="font-medium text-primary hover:underline">{i.invoice_number ?? "Draft"}</Link>{i.kind === "credit_note" && <Badge className="ml-1">Credit</Badge>}</TD>
                        <TD>{i.clients?.name}</TD>
                        <TD className="text-muted-foreground">{i.period_start ? `${i.period_start} – ${i.period_end}` : "—"}</TD>
                        <TD className={isOverdue ? "text-danger" : "text-muted-foreground"}>{i.due_date ?? "—"}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(Number(i.total))}</TD>
                        <TD className="text-right tabular-nums">{i.kind === "invoice" && !["draft", "review", "cancelled", "credited"].includes(i.status) ? formatMoney(Number(i.total) - Number(i.amount_paid)) : "—"}</TD>
                        <TD className="space-x-1">{isOverdue && <Badge tone="danger">Overdue</Badge>}<StatusBadge status={i.status} /></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>
          {overdue && <p className="mt-2 text-sm text-muted-foreground">Showing overdue invoices only.</p>}
        </div>
        {ctx.can("finance.write") && (
          <Card className="h-fit">
            <CardHeader><CardTitle>Generate invoice</CardTitle></CardHeader>
            <CardContent>
              <ServerForm action={generateInvoiceAction} submitLabel="Generate draft" pendingLabel="Generating…" toastOnSuccess={false}>
                <Field name="client_id" label="Client"><NativeSelect name="client_id">{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                <Field name="period_start" label="From"><Input name="period_start" type="date" defaultValue={localDate(prev.start)} /></Field>
                <Field name="period_end" label="To"><Input name="period_end" type="date" defaultValue={localDate(new Date(prev.end.getTime() - 1))} /></Field>
                <p className="text-xs text-muted-foreground">Includes agency-approved timesheets not yet invoiced. Weekend, night, holiday and overtime rates come from the rates locked at confirmation.</p>
              </ServerForm>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
