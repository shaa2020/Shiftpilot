import type { Metadata } from "next";
import { Download, Landmark } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { closePayrollPeriodAction, createPayrollPeriodAction, generatePayrollExportAction } from "./actions";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const ctx = await requireStaff("payroll.export");
  const supabase = await createClient();
  const { data: periods } = await supabase.from("payroll_periods").select("*, payroll_exports(id, status, line_count, totals, generated_at)").eq("agency_id", ctx.agencyId).order("period_start", { ascending: false }).limit(50);
  return (
    <>
      <PageHeader title="Payroll exports" description="Approved employee hours per payroll period, for your payroll provider." />
      <Alert tone="info" className="mb-6">ShiftPilot exports hours by category (regular, night, weekend, public holiday, overtime) with the gross hourly wage locked at confirmation. Wage tax, social security, pension and CAO allowances are calculated by your payroll provider, not by ShiftPilot.</Alert>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {!periods?.length && <EmptyState icon={Landmark} title="No payroll periods yet" />}
          {(periods ?? []).map((p) => {
            const current = p.payroll_exports.find((e) => e.status !== "superseded");
            const totals = (current?.totals ?? {}) as Record<string, number>;
            return (
              <Card key={p.id}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <div><CardTitle className="flex items-center gap-2">{p.name} <StatusBadge status={p.status} /></CardTitle><CardDescription>{p.period_start} – {p.period_end} · {p.frequency.replace("_", "-")}</CardDescription></div>
                  <div className="flex gap-2">
                    {p.status !== "closed" && <ConfirmAction action={generatePayrollExportAction} fields={{ id: p.id }} title={current ? "Regenerate export?" : "Generate export?"} description={current ? "The previous export is marked superseded." : "Includes agency-approved employee timesheets in this period."} variant="soft">{current ? "Regenerate" : "Generate export"}</ConfirmAction>}
                    {current && <Button asChild size="sm" variant="secondary"><a href={`/api/payroll-exports/${current.id}`}><Download /> CSV</a></Button>}
                    {p.status === "exported" && <ConfirmAction action={closePayrollPeriodAction} fields={{ id: p.id }} title="Close this period?" description="No further exports can be generated." variant="ghost">Close</ConfirmAction>}
                  </div>
                </CardHeader>
                {current && (
                  <CardContent className="text-sm">
                    {current.line_count} timesheet(s) · generated {formatDateTime(current.generated_at)} · total {hoursLabel(totals.total ?? 0)} h
                    (regular {hoursLabel(totals.regular ?? 0)}, night {hoursLabel(totals.night ?? 0)}, weekend {hoursLabel(totals.weekend ?? 0)}, holiday {hoursLabel(totals.public_holiday ?? 0)}, overtime {hoursLabel(totals.overtime ?? 0)})
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>New payroll period</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={createPayrollPeriodAction} submitLabel="Create period" resetOnSuccess>
              <Field name="name" label="Name" required><Input name="name" placeholder="Week 12 / March 2027" /></Field>
              <Field name="frequency" label="Frequency"><NativeSelect name="frequency" defaultValue="weekly"><option value="weekly">Weekly</option><option value="four_weekly">Four-weekly</option><option value="monthly">Monthly</option></NativeSelect></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field name="period_start" label="From" required><Input name="period_start" type="date" /></Field>
                <Field name="period_end" label="To" required><Input name="period_end" type="date" /></Field>
              </div>
            </ServerForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
