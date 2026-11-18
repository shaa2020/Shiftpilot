import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, UserCheck } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dayRange, formatTime } from "@/lib/time";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { staffAttendanceAction } from "../timesheets/actions";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const ctx = await requireStaff("attendance.read");
  const supabase = await createClient();
  const today = dayRange(new Date());
  const [{ data: alerts }, { data: todays }] = await Promise.all([
    supabase.rpc("attendance_alerts", { p_agency_id: ctx.agencyId }),
    supabase.from("shift_assignments")
      .select("id, status, starts_at, ends_at, shift_id, workers(first_name, last_name, phone), shifts(title, clients(name))")
      .eq("agency_id", ctx.agencyId)
      .gte("starts_at", today.start.toISOString()).lt("starts_at", today.end.toISOString())
      .in("status", ["confirmed", "checked_in", "checked_out", "completed", "no_show"])
      .order("starts_at"),
  ]);
  const missing = (alerts ?? []).filter((a) => a.alert === "missing_check_in");
  const late = (alerts ?? []).filter((a) => a.alert === "late_check_in");
  const onDuty = (todays ?? []).filter((a) => a.status === "checked_in");
  const recordable = (todays ?? []).filter((a) => a.status === "confirmed" || a.status === "checked_in");
  return (
    <>
      <PageHeader title="Attendance today" description="Live check-in status for today's shifts." />
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="On duty now" value={onDuty.length} icon={UserCheck} tone="success" />
        <StatCard label="Missing check-ins" value={missing.length} icon={AlertTriangle} tone={missing.length ? "danger" : "neutral"} />
        <StatCard label="Late arrivals" value={late.length} tone={late.length ? "warning" : "neutral"} />
      </section>
      {(missing.length > 0 || late.length > 0) && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {[...missing, ...late].map((a) => (
                <li key={`${a.alert}-${a.assignment_id}`} className="flex justify-between gap-2 py-2">
                  <span><span className="font-medium">{a.worker_name}</span> · <Link className="text-primary hover:underline" href={`/admin/shifts/${a.shift_id}`}>{a.shift_title}</Link> · {a.client_name}</span>
                  <span className={a.alert === "missing_check_in" ? "text-danger" : "text-warning"}>{a.alert === "missing_check_in" ? `Not checked in (${a.minutes_late} min)` : `${a.minutes_late} min late`}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader><CardTitle>Today&apos;s assignments</CardTitle></CardHeader>
          {!todays?.length ? <EmptyState title="No assignments today" className="m-5" /> : (
            <Table>
              <THead><tr><TH>Time</TH><TH>Worker</TH><TH>Shift</TH><TH>Status</TH></tr></THead>
              <TBody>
                {todays.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">{formatTime(a.starts_at)}–{formatTime(a.ends_at)}</TD>
                    <TD>{a.workers?.first_name} {a.workers?.last_name}{a.workers?.phone && <p className="text-xs"><a className="text-primary" href={`tel:${a.workers.phone}`}>{a.workers.phone}</a></p>}</TD>
                    <TD><Link className="text-primary hover:underline" href={`/admin/shifts/${a.shift_id}`}>{a.shifts?.title}</Link><p className="text-xs text-muted-foreground">{a.shifts?.clients?.name}</p></TD>
                    <TD><StatusBadge status={a.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        {ctx.can("attendance.correct") && recordable.length > 0 && (
          <Card className="h-fit">
            <CardHeader><CardTitle>Record on behalf of a worker</CardTitle></CardHeader>
            <CardContent>
              <ServerForm action={staffAttendanceAction} submitLabel="Record" resetOnSuccess>
                <Field name="assignment_id" label="Assignment"><NativeSelect name="assignment_id">{recordable.map((a) => <option key={a.id} value={a.id}>{a.workers?.first_name} {a.workers?.last_name} · {a.shifts?.title}</option>)}</NativeSelect></Field>
                <Field name="event_type" label="Event"><NativeSelect name="event_type"><option value="check_in">Check in</option><option value="check_out">Check out</option><option value="break_start">Break start</option><option value="break_end">Break end</option></NativeSelect></Field>
                <Field name="occurred_at" label="Time"><Input name="occurred_at" type="datetime-local" /></Field>
                <Field name="note" label="Reason" hint="Staff entries are flagged and visible to the client."><Input name="note" /></Field>
              </ServerForm>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
