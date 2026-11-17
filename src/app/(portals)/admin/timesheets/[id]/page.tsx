import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatTime, formatDate } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { agencyApproveAction, decideCorrectionAction, resolveDisputeAction } from "../actions";

export const metadata: Metadata = { title: "Timesheet" };

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default async function TimesheetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("timesheets.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: t } = await supabase.from("timesheets").select("*, clients(name), shifts(id, title), workers(id, first_name, last_name)").eq("id", id).maybeSingle();
  if (!t) notFound();
  const [entries, approvals, corrections, events] = await Promise.all([
    supabase.from("timesheet_entries").select("*").eq("timesheet_id", id).order("created_at"),
    supabase.from("timesheet_approvals").select("*, profiles!timesheet_approvals_decided_by_fkey(full_name, email)").eq("timesheet_id", id).order("decided_at"),
    supabase.from("attendance_corrections").select("*").eq("timesheet_id", id).order("created_at", { ascending: false }),
    supabase.from("attendance_events").select("event_type, server_recorded_at, device_recorded_at, is_offline_sync, source, location_verified, note").eq("assignment_id", t.assignment_id).order("server_recorded_at"),
  ]);
  return (
    <>
      <Link href="/admin/timesheets" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Timesheets</Link>
      <PageHeader title={`${t.workers?.first_name} ${t.workers?.last_name} · ${formatDate(t.scheduled_start)}`} description={`${t.clients?.name} · ${t.shifts?.title}`}
        actions={<div className="flex items-center gap-2"><StatusBadge status={t.status} />
          {t.status === "client_approved" && ctx.can("timesheets.approve") && <ConfirmAction action={agencyApproveAction} fields={{ id }} title="Approve as agency?" description="The timesheet becomes final and can be invoiced and exported to payroll." confirmLabel="Approve" variant="default">Approve</ConfirmAction>}
        </div>} />
      {t.has_offline_events && <Alert tone="warning" className="mb-4">Contains offline or staff-entered attendance. These times were not verified in real time; check before approving.</Alert>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Hours</CardTitle></CardHeader>
            <CardContent>
              <DetailList items={[
                ["Planned", `${formatTime(t.scheduled_start)}–${formatTime(t.scheduled_end)} · ${t.scheduled_break_minutes} min break`],
                ["Recorded", `${t.actual_start ? formatTime(t.actual_start) : "—"}–${t.actual_end ? formatTime(t.actual_end) : "—"} · ${t.break_minutes} min break`],
                ["Worked", `${hoursLabel(t.worked_minutes ?? 0)} h`], ["Overtime", `${hoursLabel(t.overtime_minutes)} h`],
                ["Late", `${t.late_minutes} min`], ["Early departure", `${t.early_departure_minutes} min`],
              ]} />
              <h3 className="mb-1 mt-5 text-sm font-medium">Entries</h3>
              <ul className="text-sm">{(entries.data ?? []).map((e) => <li key={e.id}>{humanize(e.entry_kind)}: <span className="tabular-nums">{e.minutes > 0 ? "+" : ""}{hoursLabel(Math.abs(e.minutes))}{e.minutes < 0 ? " (deduction)" : ""}</span>{e.note && <span className="text-muted-foreground"> · {e.note}</span>}</li>)}</ul>
            </CardContent>
          </Card>
          {t.status === "disputed" && ctx.can("attendance.correct") && (
            <Card>
              <CardHeader><CardTitle>Resolve dispute</CardTitle></CardHeader>
              <CardContent>
                <ServerForm action={resolveDisputeAction.bind(null, id)} submitLabel="Correct and resubmit to client">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field name="actual_start" label="Start"><Input name="actual_start" type="datetime-local" defaultValue={toLocalInput(t.actual_start)} /></Field>
                    <Field name="actual_end" label="End"><Input name="actual_end" type="datetime-local" defaultValue={toLocalInput(t.actual_end)} /></Field>
                    <Field name="break_minutes" label="Break (min)"><Input name="break_minutes" type="number" min={0} defaultValue={t.break_minutes} /></Field>
                  </div>
                  <Field name="note" label="What was agreed?"><Input name="note" /></Field>
                </ServerForm>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Correction requests</CardTitle></CardHeader>
            <CardContent>
              {!corrections.data?.length ? <p className="text-sm text-muted-foreground">None.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {corrections.data.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <div>
                        <p><Badge>{humanize(c.requester_type)}</Badge> {c.reason}</p>
                        <p className="text-xs text-muted-foreground">Proposed: {c.proposed_start ? formatDateTime(c.proposed_start) : "—"} → {c.proposed_end ? formatDateTime(c.proposed_end) : "—"}{c.proposed_break_minutes != null ? ` · break ${c.proposed_break_minutes} min` : ""}</p>
                        {c.decision_note && <p className="text-xs">Decision: {c.decision_note}</p>}
                      </div>
                      {c.status === "pending" && ctx.can("attendance.correct") ? (
                        <span className="space-x-1">
                          <ConfirmAction action={decideCorrectionAction} fields={{ id: c.id, approve: "true" }} title="Apply this correction?" description="If the timesheet is already approved, the difference is added as an adjustment; approved values are never overwritten." withReason="Note" variant="soft" confirmLabel="Apply">Apply</ConfirmAction>
                          <ConfirmAction action={decideCorrectionAction} fields={{ id: c.id, approve: "false" }} title="Reject this correction?" withReason="Reason" variant="ghost" destructive confirmLabel="Reject">Reject</ConfirmAction>
                        </span>
                      ) : <StatusBadge status={c.status} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Attendance events</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(events.data ?? []).map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{humanize(e.event_type)}</span> {formatDateTime(e.server_recorded_at)}
                    {e.is_offline_sync && <span className="block text-xs text-warning">Device/stated time {e.device_recorded_at ? formatDateTime(e.device_recorded_at) : "—"} · {e.source === "admin_entry" ? "staff entry" : "offline sync"}</span>}
                    {e.location_verified === true && <span className="block text-xs text-success">Location verified</span>}
                    {e.location_verified === false && <span className="block text-xs text-danger">Outside the check-in radius</span>}
                    {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Approval history</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(approvals.data ?? []).map((a) => <li key={a.id}><Badge tone={a.decision === "approved" ? "success" : "warning"}>{humanize(a.approver_type)} {a.decision}</Badge> <span className="text-muted-foreground">{a.profiles?.full_name ?? a.profiles?.email} · {formatDateTime(a.decided_at)}</span>{a.comment && <p>{a.comment}</p>}</li>)}
                {!approvals.data?.length && <li className="text-muted-foreground">No decisions yet.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
