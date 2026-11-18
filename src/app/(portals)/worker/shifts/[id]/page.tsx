import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, Building2, CalendarPlus, CarFront, Clock, Coffee, DoorOpen, Euro, History, Info, MapPin, MessageSquare, Navigation, Phone, ShieldCheck, Shirt, UserRound,
} from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney, formatTime, isoToLocalInput, nowMs } from "@/lib/time";
import { getAttendancePolicy, hoursLabel } from "@/lib/data/worker";
import { directionsUrl } from "@/lib/maps";
import { STATUS_HELP, durationLabel, shiftLength, startsIn } from "@/lib/shift-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { AttendanceControls } from "@/components/worker/attendance-controls";
import { DateTile, DetailRow } from "@/components/worker/shift-ui";
import { reportAbsenceAction, requestCorrectionAction } from "../../actions";

export const metadata: Metadata = { title: "Shift" };

export default async function WorkerShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorker();
  const now = nowMs();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("shift_assignments")
    .select("*, shifts(title, instructions, dress_code, break_minutes, status, clients(name), client_locations(name, address_line1, postal_code, city, latitude, longitude, arrival_instructions, parking_info, site_contact_name, site_contact_phone)), shift_positions(job_positions(name, description, default_dress_code, safety_requirements)), break_records(id, started_at, ended_at)")
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
  const s = a.shifts;
  const loc = s.client_locations;
  const p = pay.data?.[0];
  const len = shiftLength(a.starts_at, a.ends_at, s.break_minutes);
  const when = startsIn(a.starts_at, a.ends_at, now);
  const breakOpen = a.break_records.some((b) => !b.ended_at);
  const upcoming = new Date(a.ends_at).getTime() > now;
  const active = ["accepted", "confirmed", "checked_in", "replacement_requested"].includes(a.status);
  const canAttend = a.status === "checked_in" || (a.status === "confirmed" && new Date(a.starts_at).getTime() - now < 2 * 3600_000 && upcoming);
  const hourly = p?.hourly_amount != null ? Number(p.hourly_amount) : null;
  const subject = encodeURIComponent(`${s.title} · ${formatDate(a.starts_at)}`);
  const address = [loc?.address_line1, [loc?.postal_code, loc?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  const actions = [
    loc && upcoming ? { href: directionsUrl(loc), label: "Directions", icon: Navigation, external: true } : null,
    loc?.site_contact_phone && upcoming ? { href: `tel:${loc.site_contact_phone}`, label: "Call site", icon: Phone, external: true } : null,
    { href: `/worker/messages?subject=${subject}`, label: "Ask agency", icon: MessageSquare, external: false },
    active ? { href: `/api/worker/shifts/${id}/ics`, label: "Calendar", icon: CalendarPlus, external: true } : null,
  ].filter(Boolean) as { href: string; label: string; icon: typeof Navigation; external: boolean }[];

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/worker/schedule" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> My schedule
      </Link>

      {/* Summary */}
      <Card className="mb-4 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40" aria-hidden />
        <CardContent className="space-y-4 pt-5">
          <div className="flex gap-4">
            <DateTile iso={a.starts_at} className="w-16" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                {upcoming && active && <Badge tone={when.tone}>{when.label}</Badge>}
              </div>
              <h1 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{s.title}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{[a.shift_positions?.job_positions?.name, s.clients?.name].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-surface-muted p-3 text-center">
            <div><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Time</dt><dd className="text-sm font-semibold tabular-nums">{formatTime(a.starts_at)}–{formatTime(a.ends_at)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Length</dt><dd className="text-sm font-semibold">{durationLabel(len.total)}</dd></div>
            <div><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Paid</dt><dd className="text-sm font-semibold">{durationLabel(len.paid)}</dd></div>
          </dl>
          {STATUS_HELP[a.status] && <p className="flex gap-2 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{STATUS_HELP[a.status]}</p>}
          {/* Desktop / tablet action row (phones get the sticky bar below). */}
          <div className="hidden flex-wrap gap-2 sm:flex">
            {actions.map((x) => (
              <Button key={x.label} asChild variant={x.label === "Directions" ? "default" : "secondary"} size="sm">
                <a href={x.href} {...(x.external && x.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}><x.icon aria-hidden /> {x.label === "Calendar" ? "Add to calendar" : x.label === "Ask agency" ? "Message the agency" : x.label}</a>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {canAttend && (
        <Card className="mb-4 border-primary/40 ring-1 ring-primary/20">
          <CardHeader><CardTitle>Check in & out</CardTitle></CardHeader>
          <CardContent>
            <AttendanceControls assignmentId={id} status={a.status} breakOpen={breakOpen} locationEnabled={policy.location_verification_enabled} privacyNotice={policy.location_privacy_notice} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Where</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <DetailRow icon={MapPin} label="Location">
                <p className="font-medium">{loc?.name ?? "—"}</p>
                {address && <p className="text-muted-foreground">{address}</p>}
              </DetailRow>
              {loc?.arrival_instructions && <DetailRow icon={DoorOpen} label="On arrival"><p className="whitespace-pre-line">{loc.arrival_instructions}</p></DetailRow>}
              {loc?.parking_info && <DetailRow icon={CarFront} label="Parking & travel"><p className="whitespace-pre-line">{loc.parking_info}</p></DetailRow>}
              {loc?.site_contact_name && (
                <DetailRow icon={UserRound} label="Contact on site">
                  <p>{loc.site_contact_name}</p>
                  {loc.site_contact_phone && <a className="font-medium text-primary underline-offset-2 hover:underline" href={`tel:${loc.site_contact_phone}`}>{loc.site_contact_phone}</a>}
                </DetailRow>
              )}
              {loc && <Button asChild variant="secondary" className="w-full sm:w-auto"><a href={directionsUrl(loc)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> Open in maps</a></Button>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>What to know</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <DetailRow icon={Clock} label="When">
                <p>{formatDate(a.starts_at)}</p>
                <p className="text-muted-foreground tabular-nums">{formatTime(a.starts_at)}–{formatTime(a.ends_at)} · {durationLabel(len.total)} incl. break</p>
              </DetailRow>
              <DetailRow icon={Coffee} label="Break">{s.break_minutes ? `${s.break_minutes} minutes (unpaid)` : "No scheduled break"}</DetailRow>
              <DetailRow icon={Shirt} label="Dress code">{s.dress_code || a.shift_positions?.job_positions?.default_dress_code || <span className="text-muted-foreground">No dress code given</span>}</DetailRow>
              {a.shift_positions?.job_positions?.safety_requirements && <DetailRow icon={ShieldCheck} label="Safety"><p className="whitespace-pre-line">{a.shift_positions.job_positions.safety_requirements}</p></DetailRow>}
              <DetailRow icon={Building2} label="Client">{s.clients?.name ?? "—"}</DetailRow>
              {a.shift_positions?.job_positions?.description && <DetailRow icon={Info} label="About the role"><p className="whitespace-pre-line">{a.shift_positions.job_positions.description}</p></DetailRow>}
              {s.instructions && (
                <div className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
                  <p className="font-semibold">Instructions</p>
                  <p className="mt-1 whitespace-pre-line">{s.instructions}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {p && (
            <Card>
              <CardHeader><CardTitle>Pay</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <DetailRow icon={Euro} label={p.pay_basis === "employee_wage" ? "Gross hourly wage" : "Agreed hourly rate (excl. VAT)"}>
                  <p className="text-lg font-semibold tabular-nums">{hourly != null ? formatMoney(hourly) : "—"}</p>
                </DetailRow>
                {hourly != null && (
                  <div className="rounded-xl bg-surface-muted p-3 text-sm">
                    <p className="flex justify-between"><span>Scheduled paid time</span><span className="tabular-nums">{durationLabel(len.paid)}</span></p>
                    <p className="flex justify-between font-semibold"><span>Estimate for this shift</span><span className="tabular-nums">{formatMoney((hourly * len.paid) / 60)}</span></p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {p.pay_basis === "employee_wage"
                    ? "An estimate based on scheduled hours. Your actual pay follows approved hours and is calculated by payroll, including any allowances and deductions."
                    : "An estimate based on scheduled hours. Invoice the agency for approved hours under Earnings."}
                </p>
              </CardContent>
            </Card>
          )}

          {events.data && events.data.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" aria-hidden /> Timeline</CardTitle></CardHeader>
              <CardContent>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {events.data.map((e, i) => (
                    <li key={i} className="text-sm">
                      <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                      <p className="font-medium">{humanize(e.event_type)}</p>
                      <p className="text-muted-foreground">
                        {formatDateTime(e.is_offline_sync && e.device_recorded_at ? e.device_recorded_at : e.server_recorded_at)}
                        {e.is_offline_sync && <span className="text-warning"> · recorded offline / by staff</span>}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {ts.data && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2">Timesheet <StatusBadge status={ts.data.status} /></CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-3 gap-2 rounded-xl bg-surface-muted p-3 text-center">
                  <div><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Start</dt><dd className="font-semibold tabular-nums">{ts.data.actual_start ? formatTime(ts.data.actual_start) : "—"}</dd></div>
                  <div><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">End</dt><dd className="font-semibold tabular-nums">{ts.data.actual_end ? formatTime(ts.data.actual_end) : "—"}</dd></div>
                  <div><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Worked</dt><dd className="font-semibold tabular-nums">{hoursLabel(ts.data.worked_minutes ?? 0)}</dd></div>
                </dl>
                <p className="text-muted-foreground">Break {ts.data.break_minutes} min. The client approves first, then the agency.</p>
                {ts.data.status !== "locked" && (
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer font-medium text-primary">Something wrong? Request a correction</summary>
                    <ServerForm action={requestCorrectionAction} submitLabel="Request correction" resetOnSuccess className="mt-3">
                      <input type="hidden" name="timesheet_id" value={ts.data.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field name="proposed_start" label="Actual start"><Input name="proposed_start" type="datetime-local" defaultValue={isoToLocalInput(ts.data.actual_start)} /></Field>
                        <Field name="proposed_end" label="Actual end"><Input name="proposed_end" type="datetime-local" defaultValue={isoToLocalInput(ts.data.actual_end)} /></Field>
                      </div>
                      <Field name="proposed_break_minutes" label="Break (minutes)"><Input name="proposed_break_minutes" type="number" min={0} inputMode="numeric" defaultValue={ts.data.break_minutes} /></Field>
                      <Field name="reason" label="What happened?" required><Input name="reason" /></Field>
                    </ServerForm>
                  </details>
                )}
              </CardContent>
            </Card>
          )}

          {a.status === "confirmed" && new Date(a.starts_at).getTime() > now && (
            <Card>
              <CardContent className="flex flex-col gap-3 pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground">Can&apos;t work this shift? Tell the agency as early as possible so they can find a replacement.</p>
                <ConfirmAction action={reportAbsenceAction} fields={{ id }} title="Report that you cannot work this shift?" description="The agency will arrange a replacement. Please report as early as possible." withReason="Reason" destructive variant="secondary" confirmLabel="Report absence">I can&apos;t make it</ConfirmAction>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Phone: quick actions stay within thumb reach above the tab bar. */}
      <div className="h-16 sm:hidden" aria-hidden />
      <nav aria-label="Shift actions" className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 px-3 sm:hidden">
        <div className="mx-auto grid max-w-lg gap-1 rounded-2xl border border-border/70 bg-surface/90 p-1.5 shadow-lg backdrop-blur-xl" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
          {actions.map((x) => (
            <a key={x.label} href={x.href} {...(x.external && x.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium text-foreground active:bg-primary-soft">
              <x.icon className="size-5 text-primary" aria-hidden />
              {x.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
