import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import {
  addApplicationNoteAction, addScreeningAction, assignRecruiterAction, convertToWorkerAction, recordInterviewOutcomeAction,
  scheduleInterviewAction, setApplicationStatusAction,
} from "../../actions";

export const metadata: Metadata = { title: "Application" };
const NEXT: Record<string, string[]> = {
  new: ["screening", "interview", "rejected"], screening: ["interview", "assessment", "rejected"], interview: ["assessment", "offer", "rejected"],
  assessment: ["offer", "rejected"], offer: ["rejected", "withdrawn"], onboarding: ["hired"], hired: [], rejected: ["screening"], withdrawn: [],
};

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("recruitment.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: a } = await supabase.from("applications").select("*, job_openings(title, engagement_types)").eq("id", id).maybeSingle();
  if (!a) notFound();
  const [docs, interviews, screening, notes, staff] = await Promise.all([
    supabase.from("application_documents").select("kind, documents(id, title, current_version)").eq("application_id", id),
    supabase.from("interviews").select("*").eq("application_id", id).order("scheduled_at"),
    supabase.from("screening_records").select("*").eq("application_id", id).order("created_at"),
    supabase.from("internal_notes").select("id, body, created_at").eq("subject_type", "application").eq("subject_id", id).order("created_at", { ascending: false }),
    supabase.from("user_roles").select("user_id, roles(key), profiles!user_roles_user_id_fkey(full_name, email)").eq("agency_id", ctx.agencyId),
  ]);
  const canWrite = ctx.can("recruitment.write");
  const recruiters = [...new Map((staff.data ?? []).map((s) => [s.user_id, s.profiles?.full_name ?? s.profiles?.email ?? ""])).entries()];

  return (
    <>
      <Link href="/admin/recruitment" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Recruitment</Link>
      <PageHeader title={`${a.first_name} ${a.last_name}`} description={a.job_openings?.title ?? "Open application"} actions={<StatusBadge status={a.status} />} />
      {a.status === "rejected" && <Alert tone="danger" title="Rejected" className="mb-4">{a.rejection_reason}</Alert>}
      {a.worker_id && <Alert tone="success" className="mb-4">A worker record exists. <Link className="underline" href={`/admin/workers/${a.worker_id}`}>Open worker</Link></Alert>}

      {canWrite && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap items-center gap-2 pt-5">
            {(NEXT[a.status] ?? []).map((s) => (
              <ConfirmAction key={s} action={setApplicationStatusAction} fields={{ id, status: s }} title={`Move to ${humanize(s)}?`} withReason={s === "rejected" ? "Reason (kept internally; communicate respectfully to the applicant)" : undefined} variant={s === "rejected" ? "ghost" : "secondary"} destructive={s === "rejected"}>
                {humanize(s)}
              </ConfirmAction>
            ))}
            {!a.worker_id && ctx.can("workers.write") && ["offer", "assessment", "interview"].includes(a.status) && (
              (["employee", "freelancer"] as const).map((e) => (
                <ConfirmAction key={e} action={convertToWorkerAction} fields={{ id, engagement: e }} title={`Hire as ${e === "employee" ? "agency employee" : "freelancer"}?`} description="Creates a worker record and starts onboarding. Activation still requires identity, eligibility and contract or classification checks." confirmLabel="Hire" variant="default">
                  Hire as {e}
                </ConfirmAction>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Application</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <DetailList items={[
                ["Email", a.email], ["Phone", a.phone], ["City", a.city], ["Preferred pathway", a.preferred_engagement ? humanize(a.preferred_engagement) : "—"],
                ["Source", a.source], ["Received", formatDateTime(a.created_at)], ["Privacy notice", `${a.privacy_notice_version} · acknowledged ${formatDateTime(a.privacy_acknowledged_at)}`],
                ["Retain until", a.retention_until],
              ]} />
              {a.motivation && <div><p className="text-sm text-muted-foreground">Motivation</p><p className="mt-1 whitespace-pre-wrap text-sm">{a.motivation}</p></div>}
              <div className="flex flex-wrap gap-2">
                {(docs.data ?? []).map((d) => d.documents && (
                  <a key={d.documents.id} href={`/api/documents/${d.documents.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted">
                    <Download className="size-4" aria-hidden /> {humanize(d.kind)}
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Interviews</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!interviews.data?.length ? <p className="text-sm text-muted-foreground">No interviews scheduled.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {interviews.data.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{formatDateTime(i.scheduled_at)} · {humanize(i.mode)} · {i.duration_minutes} min {i.location_or_link && <span className="text-muted-foreground">· {i.location_or_link}</span>} <StatusBadge status={i.status} />{i.outcome && <Badge tone={i.outcome === "positive" ? "success" : i.outcome === "negative" ? "danger" : "neutral"}>{i.outcome}</Badge>}
                        {i.notes && <span className="block text-muted-foreground">{i.notes}</span>}
                      </span>
                      {canWrite && i.status === "scheduled" && (
                        <span className="space-x-1">
                          {(["positive", "neutral", "negative", "no_show"] as const).map((o) => (
                            <ConfirmAction key={o} action={recordInterviewOutcomeAction} fields={{ id: i.id, outcome: o }} title={`Record outcome: ${humanize(o)}`} withReason="Notes" variant="ghost">{humanize(o)}</ConfirmAction>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && (
                <ServerForm action={scheduleInterviewAction.bind(null, id)} submitLabel="Schedule interview" resetOnSuccess className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4" footerClassName="sm:col-span-4">
                  <Field name="scheduled_at" label="When"><Input name="scheduled_at" type="datetime-local" /></Field>
                  <Field name="duration_minutes" label="Minutes"><Input name="duration_minutes" type="number" defaultValue={30} min={5} /></Field>
                  <Field name="mode" label="Mode"><NativeSelect name="mode" defaultValue="video"><option value="video">Video</option><option value="phone">Phone</option><option value="in_person">In person</option></NativeSelect></Field>
                  <Field name="location_or_link" label="Location / link"><Input name="location_or_link" /></Field>
                </ServerForm>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Screening & qualification review</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!screening.data?.length ? <p className="text-sm text-muted-foreground">No screening recorded.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {screening.data.map((s) => (
                    <li key={s.id} className="py-2"><span className="font-medium">{s.criterion}</span> <Badge tone={s.result === "pass" ? "success" : s.result === "fail" ? "danger" : "warning"}>{humanize(s.result)}</Badge>{s.score !== null && <span className="text-muted-foreground"> · score {s.score}</span>}{s.notes && <p className="text-muted-foreground">{s.notes}</p>}</li>
                  ))}
                </ul>
              )}
              {canWrite && (
                <ServerForm action={addScreeningAction.bind(null, id)} submitLabel="Add" resetOnSuccess className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3" footerClassName="sm:col-span-3">
                  <Field name="criterion" label="Criterion"><Input name="criterion" placeholder="Forklift experience" /></Field>
                  <Field name="result" label="Result"><NativeSelect name="result" defaultValue="pass"><option value="pass">Pass</option><option value="fail">Fail</option><option value="needs_information">Needs information</option></NativeSelect></Field>
                  <Field name="score" label="Score (0–100)"><Input name="score" type="number" min={0} max={100} /></Field>
                  <Field name="notes" label="Notes" className="sm:col-span-3"><Textarea name="notes" rows={2} /></Field>
                </ServerForm>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          {canWrite && (
            <Card>
              <CardHeader><CardTitle>Recruiter</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {recruiters.map(([uid, name]) => (
                  <ConfirmAction key={uid} action={assignRecruiterAction} fields={{ id, recruiter_id: uid }} title={`Assign ${name}?`} variant={uid === a.assigned_recruiter_id ? "soft" : "ghost"}>{uid === a.assigned_recruiter_id ? "✓ " : ""}{name}</ConfirmAction>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Internal notes</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ServerForm action={addApplicationNoteAction.bind(null, id)} submitLabel="Add note" resetOnSuccess>
                <Field name="body" label="Note"><Textarea name="body" rows={3} /></Field>
              </ServerForm>
              {!notes.data?.length ? <EmptyState title="No notes" /> : (
                <ul className="divide-y divide-border text-sm">{notes.data.map((n) => <li key={n.id} className="py-2"><p className="whitespace-pre-wrap">{n.body}</p><p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p></li>)}</ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
