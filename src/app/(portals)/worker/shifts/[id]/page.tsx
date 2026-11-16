import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, MapPin, Navigation, Shirt } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney, formatTime } from "@/lib/time";
import { nowMs } from "@/lib/time";
import { getAttendancePolicy, hoursLabel } from "@/lib/data/worker";
import { directionsUrl } from "@/lib/maps";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { AttendanceControls } from "@/components/worker/attendance-controls";
import { reportAbsenceAction, requestCorrectionAction } from "../../actions";

export const metadata: Metadata = { title: "Shift" };

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default async function WorkerShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorker();
  const now_ms = nowMs();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("shift_assignments")
    .select("*, shifts(title, instructions, dress_code, break_minutes, clients(name), client_locations(name, address_line1, postal_code, city, latitude, longitude, arrival_instructions, parking_info, site_contact_name, site_contact_phone)), shift_positions(job_positions(name)), break_records(id, ended_at)")
    .eq("id", id)
    .eq("worker_id", ctx.workerId)
    .maybeSingle();
  if (!a || !a.shifts) notFound();
  const [policy, pay, ts, events] = await Promise.all([
    getAttendancePolicy(ctx.workerId),
    supabase.rpc("my_assignment_pay", { p_assignment_id: id }),
    supabase.from("timesheets").select("id, status, actual_start, actual_end, break_minutes, worked_minutes, has_offline_events").eq("assignment_id", id).maybeSingle(),
    supabase.from("attendance_events").select("event_type, server_recorded_at, device_recorded_at, is_offline_sync").eq("assignment_id", id).order("server_recorded_at"),
  ]);
  const loc = a.shifts.client_locations;
  const s = a.shifts;
  const p = pay.data?.[0];
  const breakOpen = a.break_records.some((b) => !b.ended_at);
  const canAttend = a.status === "checked_in" || (a.status === "confirmed" && new Date(a.starts_at).getTime() - now_ms < 2 * 3600_000 && new Date(a.ends_at).getTime() > now_ms);

  return (
    <>
      <Link href="/worker/schedule" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Schedule</Link>
      <PageHeader title={s.title} description={`${a.shift_positions?.job_positions?.name ?? ""} · ${s.clients?.name ?? ""}`} actions={<StatusBadge status={a.status} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm">
            <p className="flex items-start gap-2"><Clock className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><span>{formatDate(a.starts_at)}<br />{formatTime(a.starts_at)}–{formatTime(a.ends_at)} · {s.break_minutes} min break</span></p>
            <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><span>{loc?.name}<br />{loc?.address_line1}, {loc?.postal_code} {loc?.city}</span></p>
            {s.dress_code && <p className="flex items-start gap-2"><Shirt className="mt-0.5 size-4 text-muted-foreground" aria-hidden />{s.dress_code}</p>}
            {loc && <Button asChild variant="secondary"><a href={directionsUrl(loc)} target="_blank" rel="noopener noreferrer"><Navigation /> Get directions</a></Button>}
            {loc?.arrival_instructions && <Alert tone="info" title="On arrival">{loc.arrival_instructions}</Alert>}
            {loc?.parking_info && <p className="text-muted-foreground">Parking: {loc.parking_info}</p>}
            {loc?.site_contact_name && <p className="text-muted-foreground">Site contact: {loc.site_contact_name}{loc.site_contact_phone ? <> · <a className="text-primary" href={`tel:${loc.site_contact_phone}`}>{loc.site_contact_phone}</a></> : null}</p>}
            {s.instructions && <div><p className="font-medium">Instructions</p><p className="whitespace-pre-wrap text-muted-foreground">{s.instructions}</p></div>}
          </CardContent>
        </Card>
        <div className="space-y-4">
          {canAttend && (
            <Card>
              <CardHeader><CardTitle>Attendance</CardTitle></CardHeader>
              <CardContent><AttendanceControls assignmentId={id} status={a.status} breakOpen={breakOpen} locationEnabled={policy.location_verification_enabled} privacyNotice={policy.location_privacy_notice} /></CardContent>
            </Card>
          )}
          {p && (
            <Card>
              <CardHeader><CardTitle>Your pay for this shift</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {p.pay_basis === "employee_wage" ? "Gross hourly wage" : "Agreed hourly rate (excl. VAT)"}: <span className="font-semibold tabular-nums">{p.hourly_amount != null ? formatMoney(Number(p.hourly_amount)) : "—"}</span>
                <p className="mt-1 text-xs text-muted-foreground">{p.pay_basis === "employee_wage" ? "Paid through payroll according to your contract. Allowances and deductions are calculated by payroll." : "Invoice the agency for approved hours in Earnings."}</p>
              </CardContent>
            </Card>
          )}
          {events.data && events.data.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Recorded</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {events.data.map((e, i) => (
                    <li key={i}>{humanize(e.event_type)}: {formatDateTime(e.is_offline_sync && e.device_recorded_at ? e.device_recorded_at : e.server_recorded_at)}{e.is_offline_sync && <span className="text-xs text-warning"> (recorded offline / by staff)</span>}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {ts.data && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2">Timesheet <StatusBadge status={ts.data.status} /></CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{ts.data.actual_start ? formatTime(ts.data.actual_start) : "—"}–{ts.data.actual_end ? formatTime(ts.data.actual_end) : "—"} · break {ts.data.break_minutes} min · <span className="font-semibold">{hoursLabel(ts.data.worked_minutes ?? 0)} h</span></p>
                {ts.data.status !== "locked" && (
                  <details>
                    <summary className="cursor-pointer text-primary">Something wrong? Request a correction</summary>
                    <ServerForm action={requestCorrectionAction} submitLabel="Request correction" resetOnSuccess className="mt-3">
                      <input type="hidden" name="timesheet_id" value={ts.data.id} />
                      <div className="grid grid-cols-2 gap-3">
                        <Field name="proposed_start" label="Actual start"><Input name="proposed_start" type="datetime-local" defaultValue={toLocalInput(ts.data.actual_start)} /></Field>
                        <Field name="proposed_end" label="Actual end"><Input name="proposed_end" type="datetime-local" defaultValue={toLocalInput(ts.data.actual_end)} /></Field>
                      </div>
                      <Field name="proposed_break_minutes" label="Break (minutes)"><Input name="proposed_break_minutes" type="number" min={0} defaultValue={ts.data.break_minutes} /></Field>
                      <Field name="reason" label="What happened?" required><Input name="reason" /></Field>
                    </ServerForm>
                  </details>
                )}
              </CardContent>
            </Card>
          )}
          {a.status === "confirmed" && new Date(a.starts_at).getTime() > now_ms && (
            <ConfirmAction action={reportAbsenceAction} fields={{ id }} title="Report that you cannot work this shift?" description="The agency will arrange a replacement. Please report as early as possible." withReason="Reason" destructive variant="ghost" confirmLabel="Report absence">I can&apos;t make it</ConfirmAction>
          )}
        </div>
      </div>
    </>
  );
}
