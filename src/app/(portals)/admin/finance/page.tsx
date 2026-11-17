import type { Metadata } from "next";
import Link from "next/link";
import { Euro, Receipt, TrendingUp, Wallet } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, localDate } from "@/lib/time";
import { PageHeader, StatCard } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { RevenueCostChart } from "./chart";
import { addHolidayAction, removeHolidayAction } from "./actions";

export const metadata: Metadata = { title: "Finance" };
type Row = { client?: string; industry: string; revenue: number; cost: number; margin: number; hours?: number };
type Summary = { revenue: number; credit_notes: number; net_revenue: number; employee_wage_cost: number; employer_cost_estimate: number; freelancer_cost: number; direct_cost_estimate: number; contribution_margin_estimate: number; by_client: Row[]; by_industry: Row[]; by_month: { month: string; revenue: number; cost: number }[]; note: string };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireStaff("finance.read");
  const sp = await searchParams;
  const today = localDate(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const supabase = await createClient();
  const [{ data }, { data: open }, { data: holidays }] = await Promise.all([
    supabase.rpc("financial_summary", { p_agency_id: ctx.agencyId, p_from: from, p_to: to }),
    supabase.from("invoices").select("total, amount_paid, due_date").eq("agency_id", ctx.agencyId).eq("kind", "invoice").in("status", ["issued", "partially_paid"]),
    supabase.from("public_holidays").select("id, holiday_date, name").eq("agency_id", ctx.agencyId).gte("holiday_date", `${today.slice(0, 4)}-01-01`).order("holiday_date"),
  ]);
  const s = data as unknown as Summary;
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
  for (const i of open ?? []) {
    const amt = Number(i.total) - Number(i.amount_paid);
    const days = i.due_date ? Math.floor((Date.parse(today) - Date.parse(i.due_date)) / 86400000) : 0;
    if (days <= 0) buckets.current += amt; else if (days <= 30) buckets.d30 += amt; else if (days <= 60) buckets.d60 += amt; else if (days <= 90) buckets.d90 += amt; else buckets.older += amt;
  }
  const n = (v: number) => formatMoney(Number(v));
  return (
    <>
      <PageHeader title="Finance" description="Invoiced revenue, direct staffing costs and estimated contribution margin."
        actions={<div className="flex gap-2"><Button asChild variant="secondary"><Link href="/admin/invoices">Invoices</Link></Button><Button asChild variant="secondary"><Link href="/admin/payroll">Payroll</Link></Button><Button asChild variant="secondary"><Link href="/admin/purchase-invoices">Freelancer invoices</Link></Button></div>} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">From <Input type="date" name="from" defaultValue={from} /></label>
        <label className="text-sm">To <Input type="date" name="to" defaultValue={to} /></label>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net invoiced revenue" value={n(s.net_revenue)} hint={`Invoiced ${n(s.revenue)} · credited ${n(s.credit_notes)}`} icon={Euro} tone="info" />
        <StatCard label="Direct staffing cost (estimate)" value={n(s.direct_cost_estimate)} hint={`Wages ${n(s.employee_wage_cost)} · employer est. ${n(s.employer_cost_estimate)} · freelancers ${n(s.freelancer_cost)}`} icon={Wallet} />
        <StatCard label="Estimated contribution margin" value={n(s.contribution_margin_estimate)} icon={TrendingUp} tone={s.contribution_margin_estimate >= 0 ? "success" : "danger"} hint="Not net profit" />
        <StatCard label="Outstanding receivables" value={n(Object.values(buckets).reduce((a, b) => a + b, 0))} hint={`${n(buckets.d30 + buckets.d60 + buckets.d90 + buckets.older)} overdue`} icon={Receipt} tone={buckets.older + buckets.d90 > 0 ? "danger" : "neutral"} />
      </section>
      <Alert tone="info" className="mt-4">{s.note}</Alert>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Revenue vs. direct cost</CardTitle></CardHeader>
          <CardContent><RevenueCostChart data={s.by_month.map((m) => ({ ...m, revenue: Number(m.revenue), cost: Number(m.cost) }))} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Invoice ageing</CardTitle><CardDescription><Link className="text-primary hover:underline" href="/admin/invoices?overdue=1">View overdue</Link></CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {([["Not yet due", buckets.current], ["1–30 days overdue", buckets.d30], ["31–60 days", buckets.d60], ["61–90 days", buckets.d90], ["Over 90 days", buckets.older]] as [string, number][]).map(([k, v]) => (
                <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{n(v)}</span></li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader><CardTitle>By client</CardTitle></CardHeader>
          <Table>
            <THead><tr><TH>Client</TH><TH className="text-right">Hours</TH><TH className="text-right">Revenue</TH><TH className="text-right">Est. cost</TH><TH className="text-right">Est. margin</TH></tr></THead>
            <TBody>
              {s.by_client.map((r) => (
                <TR key={r.client}><TD>{r.client}<p className="text-xs text-muted-foreground">{r.industry}</p></TD><TD className="text-right tabular-nums">{r.hours}</TD><TD className="text-right tabular-nums">{n(r.revenue)}</TD><TD className="text-right tabular-nums">{n(r.cost)}</TD><TD className="text-right tabular-nums">{n(r.margin)}</TD></TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>By industry</CardTitle></CardHeader>
          <Table>
            <THead><tr><TH>Industry</TH><TH className="text-right">Revenue</TH><TH className="text-right">Est. margin</TH></tr></THead>
            <TBody>{s.by_industry.map((r) => <TR key={r.industry}><TD>{r.industry}</TD><TD className="text-right tabular-nums">{n(r.revenue)}</TD><TD className="text-right tabular-nums">{n(r.margin)}</TD></TR>)}</TBody>
          </Table>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>Public holidays</CardTitle><CardDescription>Used for holiday rates on invoices and payroll categories. Enter the holidays that apply under your contracts/CAO — none are assumed.</CardDescription></CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <ul className="space-y-1 text-sm">
              {(holidays ?? []).map((h) => <li key={h.id} className="flex items-center justify-between">{h.holiday_date} · {h.name}{ctx.can("rates.write") && <ConfirmAction action={removeHolidayAction} fields={{ id: h.id }} title="Remove holiday?" variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>}</li>)}
              {!holidays?.length && <li className="text-muted-foreground">No holidays configured for this year.</li>}
            </ul>
            {ctx.can("rates.write") && (
              <ServerForm action={addHolidayAction} submitLabel="Add holiday" resetOnSuccess className="grid gap-3 sm:grid-cols-2" footerClassName="sm:col-span-2">
                <Field name="holiday_date" label="Date"><Input name="holiday_date" type="date" /></Field>
                <Field name="name" label="Name"><Input name="name" /></Field>
              </ServerForm>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
