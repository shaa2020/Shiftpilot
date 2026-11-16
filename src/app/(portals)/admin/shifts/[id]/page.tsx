import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, MapPin, Users, XCircle } from "lucide-react";
import { requireStaff, type StaffContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatTime, localDate, localTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import {
  addShiftPositionAction, assignWorkerAction, cancelAssignmentAction, confirmAssignmentAction, duplicateShiftAction, inviteWorkersAction,
  noShowAction, replaceAssignmentAction, rescheduleShiftAction, setShiftStatusAction, updateHeadcountAction, withdrawInvitationAction,
} from "../actions";

export const metadata: Metadata = { title: "Shift" };

type Match = { worker_id: string; full_name: string; worker_number: string; engagement_type: string; eligible: boolean; score: number; failures: string[]; warnings: string[]; notes: string[]; explanation: { distance_km?: number | null; availability?: string } };

export default async function ShiftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ match?: string }> }) {
  const ctx = await requireStaff("shifts.read");
  const { id } = await params;
  const { match } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: s } = await supabase.from("shifts").select("*, clients(id, name), client_locations(name, address_line1, city, arrival_instructions), shift_requests(id, headcount)").eq("id", id).maybeSingle();
  if (!s) notFound();
  const [{ data: positions }, { data: assignments }, { data: invitations }, { data: catalog }, { data: history }] = await Promise.all([
    supabase.from("shift_positions").select("*, job_positions(name, is_regulated)").eq("shift_id", id).order("created_at"),
    supabase.from("shift_assignments").select("*, workers(first_name, last_name, worker_number, engagement_type, phone)").eq("shift_id", id).order("created_at"),
    supabase.from("shift_invitations").select("*, workers(first_name, last_name)").eq("shift_id", id).order("created_at", { ascending: false }),
    supabase.from("job_positions").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    supabase.from("state_transitions").select("from_state, to_state, reason, created_at").eq("entity", "shift").eq("entity_id", id).order("id", { ascending: false }).limit(10),
  ]);
  const editable = ctx.can("shifts.write") && !["completed", "awaiting_approval", "approved", "invoiced", "cancelled", "in_progress"].includes(s.status);
  const canAssign = ctx.can("shifts.assign") && ["open", "offered", "partially_filled", "filled"].includes(s.status);
  const matchPosition = positions?.find((p) => p.id === match) ?? (canAssign ? positions?.find((p) => p.filled_count < p.headcount) : undefined);
  const matches: Match[] = matchPosition && canAssign
    ? (((await supabase.rpc("find_eligible_workers", { p_shift_position_id: matchPosition.id, p_include_ineligible: true })).data ?? []) as unknown as Match[])
        .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score)
        .slice(0, 40)
    : [];

  return (
    <>
      <Link href="/admin/shifts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Shifts</Link>
      <PageHeader
        title={s.title}
        description={`${s.clients?.name} · ${s.client_locations?.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} />
            {ctx.can("shifts.write") && s.status === "draft" && <ConfirmAction action={setShiftStatusAction} fields={{ id, status: "open" }} title="Open this shift for matching?" variant="default">Open shift</ConfirmAction>}
            {editable && (
              <Dialog>
                <DialogTrigger asChild><Button variant="secondary" size="sm">Reschedule</Button></DialogTrigger>
                <DialogContent title="Reschedule shift" description="Assigned workers are notified. Rescheduling is refused if it would double-book anyone.">
                  <ServerForm action={rescheduleShiftAction.bind(null, id)} submitLabel="Save">
                    <Field name="date" label="Date"><Input name="date" type="date" defaultValue={localDate(new Date(s.starts_at))} /></Field>
                    <div className="grid grid-cols-3 gap-3">
                      <Field name="start_time" label="Start"><Input name="start_time" type="time" defaultValue={localTime(s.starts_at)} /></Field>
                      <Field name="end_time" label="End"><Input name="end_time" type="time" defaultValue={localTime(s.ends_at)} /></Field>
                      <Field name="break_minutes" label="Break"><Input name="break_minutes" type="number" defaultValue={s.break_minutes} /></Field>
                    </div>
                  </ServerForm>
                </DialogContent>
              </Dialog>
            )}
            {ctx.can("shifts.write") && (
              <Dialog>
                <DialogTrigger asChild><Button variant="secondary" size="sm">Duplicate</Button></DialogTrigger>
                <DialogContent title="Duplicate shift" description="Copies times, positions and instructions to another date. Workers are not copied.">
                  <ServerForm action={duplicateShiftAction.bind(null, id)} submitLabel="Duplicate" toastOnSuccess={false}>
                    <Field name="date" label="New date"><Input name="date" type="date" /></Field>
                  </ServerForm>
                </DialogContent>
              </Dialog>
            )}
            {editable && <ConfirmAction action={setShiftStatusAction} fields={{ id, status: "cancelled" }} title="Cancel this shift?" description="All invitations are withdrawn and assigned workers and the client are notified." withReason="Cancellation reason" destructive confirmLabel="Cancel shift" variant="ghost">Cancel shift</ConfirmAction>}
          </div>
        }
      />
      {s.status === "cancelled" && <Alert tone="danger" title="Cancelled" className="mb-4">{s.cancellation_reason}</Alert>}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-start gap-3 pt-5 text-sm"><Clock className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><p className="font-medium">{formatDate(s.starts_at)}</p><p className="text-muted-foreground">{formatTime(s.starts_at)}–{formatTime(s.ends_at)} · {s.break_minutes} min break</p></div></CardContent></Card>
        <Card><CardContent className="flex items-start gap-3 pt-5 text-sm"><MapPin className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><p className="font-medium">{s.client_locations?.name}</p><p className="text-muted-foreground">{s.client_locations?.address_line1}, {s.client_locations?.city}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-start gap-3 pt-5 text-sm"><Users className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><p className="font-medium">{(positions ?? []).reduce((a, p) => a + p.filled_count, 0)} of {(positions ?? []).reduce((a, p) => a + p.headcount, 0)} filled</p><p className="text-muted-foreground">{s.dress_code ? `Dress: ${s.dress_code}` : "No dress code set"}</p></div></CardContent></Card>
      </div>
      {s.instructions && <Alert tone="info" title="Instructions" className="mb-6"><p className="whitespace-pre-wrap">{s.instructions}</p></Alert>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {(positions ?? []).map((p) => (
            <PositionCard key={p.id} shiftId={id} position={p} assignments={(assignments ?? []).filter((a) => a.shift_position_id === p.id)}
              invitations={(invitations ?? []).filter((i) => i.shift_position_id === p.id)} ctx={ctx} canAssign={canAssign} editable={editable}
              replacementCandidates={matchPosition?.id === p.id ? matches.filter((m) => m.eligible) : []} active={matchPosition?.id === p.id} />
          ))}
          {matchPosition && canAssign && (
            <Card id="matching">
              <CardHeader>
                <CardTitle>Matching: {matchPosition.job_positions?.name}</CardTitle>
                <CardDescription>Ranked by eligibility and score. Mandatory requirements can never be overridden; warnings need an override reason{ctx.can("matching.override") ? "" : " and the override permission"}.</CardDescription>
              </CardHeader>
              <CardContent>
                {matches.length === 0 ? <EmptyState icon={Users} title="No active workers to evaluate" /> : (
                  <ServerForm action={inviteWorkersAction.bind(null, matchPosition.id, id)} submitLabel="Invite selected workers" pendingLabel="Inviting…">
                    <ul className="divide-y divide-border">
                      {matches.map((m) => (
                        <li key={m.worker_id} className="flex items-start gap-3 py-3 text-sm">
                          <input type="checkbox" name="worker_ids" value={m.worker_id} disabled={!m.eligible} aria-label={`Select ${m.full_name}`} className="mt-1 size-4 accent-primary disabled:opacity-30" />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2">
                              <Link href={`/admin/workers/${m.worker_id}`} className="font-medium hover:underline">{m.full_name}</Link>
                              <span className="text-xs text-muted-foreground">{m.worker_number}</span>
                              <Badge tone={m.engagement_type === "employee" ? "info" : "neutral"}>{humanize(m.engagement_type)}</Badge>
                              {m.eligible ? <Badge tone="success">Score {m.score}</Badge> : <Badge tone="danger">Not eligible</Badge>}
                              {m.explanation?.distance_km != null && <span className="text-xs text-muted-foreground">{m.explanation.distance_km} km</span>}
                            </p>
                            <ul className="mt-1 space-y-0.5 text-xs">
                              {m.failures.map((x) => <li key={x} className="flex items-center gap-1 text-danger"><XCircle className="size-3" aria-hidden />{x}</li>)}
                              {m.warnings.map((x) => <li key={x} className="flex items-center gap-1 text-warning"><AlertTriangle className="size-3" aria-hidden />{x}</li>)}
                              {m.notes.map((x) => <li key={x} className="text-muted-foreground">· {x}</li>)}
                              {m.eligible && !m.warnings.length && <li className="flex items-center gap-1 text-success"><CheckCircle2 className="size-3" aria-hidden />All mandatory requirements met</li>}
                            </ul>
                          </div>
                          {m.eligible && (
                            <ConfirmAction action={assignWorkerAction} fields={{ position_id: matchPosition.id, worker_id: m.worker_id, shift_id: id }}
                              title={`Assign ${m.full_name} directly?`} description={m.warnings.length ? `Warnings: ${m.warnings.join("; ")}. Explain the override.` : "The worker is asked to accept the assignment."}
                              withReason={m.warnings.length ? "Override reason" : undefined} variant="soft" size="sm" confirmLabel="Assign">
                              Assign
                            </ConfirmAction>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                      <Field name="expires_hours" label="Offer expires after (hours)" hint="0 = no expiry"><Input name="expires_hours" type="number" min={0} defaultValue={24} /></Field>
                      <Field name="reason" label="Override reason (only for workers with warnings)"><Input name="reason" /></Field>
                    </div>
                  </ServerForm>
                )}
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {editable && (
            <Card>
              <CardHeader><CardTitle>Add position</CardTitle></CardHeader>
              <CardContent>
                <ServerForm action={addShiftPositionAction.bind(null, id)} submitLabel="Add position" resetOnSuccess>
                  <Field name="position_id" label="Position"><NativeSelect name="position_id">{(catalog ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                  <Field name="headcount" label="Workers needed"><Input name="headcount" type="number" min={1} defaultValue={1} /></Field>
                  <Field name="required_language_code" label="Required language"><Input name="required_language_code" maxLength={2} /></Field>
                  <CheckboxField name="allow_freelancers" label="Also offer to freelancers" />
                </ServerForm>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(history ?? []).map((h, i) => (
                  <li key={i}><span className="text-muted-foreground">{formatDateTime(h.created_at)}</span><br />{h.from_state ? `${humanize(h.from_state)} → ` : "Created as "}{humanize(h.to_state)}{h.reason ? ` · ${h.reason}` : ""}</li>
                ))}
              </ul>
              {s.shift_requests && <p className="mt-3 text-sm"><Link className="text-primary hover:underline" href={`/admin/requests/${s.shift_requests.id}`}>From client request</Link></p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

type PositionRow = { id: string; headcount: number; filled_count: number; allowed_engagements: string[]; required_language_code: string | null; job_positions: { name: string; is_regulated: boolean } | null };
type AssignmentRow = { id: string; status: string; override_reason: string | null; cancellation_reason: string | null; workers: { first_name: string; last_name: string; worker_number: string | null; engagement_type: string; phone: string | null } | null; worker_id: string };
type InvitationRow = { id: string; status: string; expires_at: string | null; decline_reason: string | null; created_at: string; workers: { first_name: string; last_name: string } | null };

function PositionCard({ shiftId, position: p, assignments, invitations, ctx, canAssign, editable, replacementCandidates, active }: {
  shiftId: string; position: PositionRow; assignments: AssignmentRow[]; invitations: InvitationRow[]; ctx: StaffContext; canAssign: boolean; editable: boolean;
  replacementCandidates: Match[]; active: boolean;
}) {
  const live = assignments.filter((a) => !["declined", "cancelled", "replaced"].includes(a.status));
  const past = assignments.filter((a) => ["declined", "cancelled", "replaced"].includes(a.status));
  const pending = invitations.filter((i) => i.status === "pending");
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">{p.job_positions?.name} {p.job_positions?.is_regulated && <Badge tone="warning">Regulated</Badge>}</CardTitle>
          <CardDescription>{p.filled_count}/{p.headcount} filled · {p.allowed_engagements.map(humanize).join(" / ")}{p.required_language_code ? ` · language ${p.required_language_code.toUpperCase()}` : ""}</CardDescription>
        </div>
        <div className="flex gap-2">
          {editable && (
            <Dialog>
              <DialogTrigger asChild><Button size="sm" variant="ghost">Headcount</Button></DialogTrigger>
              <DialogContent title="Change headcount">
                <ServerForm action={updateHeadcountAction} submitLabel="Save">
                  <input type="hidden" name="id" value={p.id} />
                  <Field name="headcount" label={`Workers needed (at least ${Math.max(1, p.filled_count)})`}><Input name="headcount" type="number" min={Math.max(1, p.filled_count)} defaultValue={p.headcount} /></Field>
                </ServerForm>
              </DialogContent>
            </Dialog>
          )}
          {canAssign && !active && <Button asChild size="sm" variant="soft"><Link href={`/admin/shifts/${shiftId}?match=${p.id}#matching`}>Find workers</Link></Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-0 pb-4">
        {live.length === 0 && pending.length === 0 ? <EmptyState icon={Users} title="Nobody assigned yet" className="mx-5" /> : (
          <Table>
            <THead><tr><TH>Worker</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
            <TBody>
              {live.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link className="font-medium hover:underline" href={`/admin/workers/${a.worker_id}`}>{a.workers?.first_name} {a.workers?.last_name}</Link>
                    <p className="text-xs text-muted-foreground">{a.workers?.worker_number}{a.workers?.phone ? ` · ${a.workers.phone}` : ""}{a.override_reason ? ` · override: ${a.override_reason}` : ""}</p>
                  </TD>
                  <TD><StatusBadge status={a.status} /></TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {ctx.can("shifts.assign") && a.status === "accepted" && <ConfirmAction action={confirmAssignmentAction} fields={{ id: a.id, shift_id: shiftId }} title="Confirm assignment?" description="Eligibility is re-checked and the client rate and worker pay are locked for this assignment." confirmLabel="Confirm">Confirm</ConfirmAction>}
                    {ctx.can("shifts.assign") && (a.status === "confirmed" || a.status === "replacement_requested") && replacementCandidates.length > 0 && (
                      <Dialog>
                        <DialogTrigger asChild><Button size="sm" variant="ghost">Replace</Button></DialogTrigger>
                        <DialogContent title="Replace worker" description="The current worker is notified and the replacement must accept.">
                          <ServerForm action={replaceAssignmentAction} submitLabel="Replace">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="shift_id" value={shiftId} />
                            <Field name="worker_id" label="Replacement"><NativeSelect name="worker_id">{replacementCandidates.map((m) => <option key={m.worker_id} value={m.worker_id}>{m.full_name} (score {m.score}{m.warnings.length ? ", has warnings" : ""})</option>)}</NativeSelect></Field>
                            <Field name="reason" label="Override reason (if the replacement has warnings)"><Input name="reason" /></Field>
                          </ServerForm>
                        </DialogContent>
                      </Dialog>
                    )}
                    {ctx.can("shifts.assign") && a.status === "confirmed" && <ConfirmAction action={noShowAction} fields={{ id: a.id, shift_id: shiftId }} title="Record a no-show?" variant="ghost" destructive confirmLabel="No-show">No-show</ConfirmAction>}
                    {ctx.can("shifts.assign") && ["invited", "accepted", "confirmed", "replacement_requested"].includes(a.status) && <ConfirmAction action={cancelAssignmentAction} fields={{ id: a.id, shift_id: shiftId }} title="Cancel this assignment?" withReason="Reason" variant="ghost" destructive confirmLabel="Cancel assignment">Cancel</ConfirmAction>}
                  </TD>
                </TR>
              ))}
              {pending.map((i) => (
                <TR key={i.id}>
                  <TD><p className="font-medium">{i.workers?.first_name} {i.workers?.last_name}</p><p className="text-xs text-muted-foreground">Offered {formatDateTime(i.created_at)}{i.expires_at ? ` · expires ${formatDateTime(i.expires_at)}` : ""}</p></TD>
                  <TD><Badge tone="info">Offer pending</Badge></TD>
                  <TD className="text-right">{ctx.can("shifts.assign") && <ConfirmAction action={withdrawInvitationAction} fields={{ id: i.id, shift_id: shiftId }} title="Withdraw offer?" variant="ghost">Withdraw</ConfirmAction>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {(past.length > 0 || invitations.some((i) => i.status !== "pending")) && (
          <details className="mx-5 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Earlier responses ({past.length + invitations.filter((i) => i.status !== "pending").length})</summary>
            <ul className="mt-2 space-y-1">
              {past.map((a) => <li key={a.id}>{a.workers?.first_name} {a.workers?.last_name} — {humanize(a.status)}{a.cancellation_reason ? `: ${a.cancellation_reason}` : ""}</li>)}
              {invitations.filter((i) => i.status !== "pending").map((i) => <li key={i.id}>{i.workers?.first_name} {i.workers?.last_name} — offer {i.status}{i.decline_reason ? `: ${i.decline_reason}` : ""}</li>)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
