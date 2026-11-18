import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, isoToLocalInput } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { addActivityAction, completeActivityAction, convertLeadAction, setLeadOwnerAction, setLeadStageAction, updateLeadAction } from "../actions";

export const metadata: Metadata = { title: "Lead" };
const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];

const toLocal = (iso: string | null) => isoToLocalInput(iso);

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("crm.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const [activities, industries, staff] = await Promise.all([
    supabase.from("lead_activities").select("*, profiles!lead_activities_created_by_fkey(full_name, email)").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("industries").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("sort_order"),
    supabase.from("user_roles").select("user_id, profiles!user_roles_user_id_fkey(full_name, email)").eq("agency_id", ctx.agencyId),
  ]);
  const canWrite = ctx.can("crm.write");
  const owners = [...new Map((staff.data ?? []).map((s) => [s.user_id, s.profiles?.full_name ?? s.profiles?.email ?? ""])).entries()];

  const fields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field name="company_name" label="Company" required><Input name="company_name" defaultValue={lead.company_name} /></Field>
      <Field name="contact_name" label="Contact"><Input name="contact_name" defaultValue={lead.contact_name ?? ""} /></Field>
      <Field name="email" label="Email"><Input name="email" type="email" defaultValue={lead.email ?? ""} /></Field>
      <Field name="phone" label="Phone"><Input name="phone" defaultValue={lead.phone ?? ""} /></Field>
      <Field name="source" label="Source"><Input name="source" defaultValue={lead.source ?? ""} /></Field>
      <Field name="industry_id" label="Industry"><NativeSelect name="industry_id" defaultValue={lead.industry_id ?? ""}><option value="">—</option>{(industries.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect></Field>
      <Field name="estimated_monthly_hours" label="Est. hours / month"><Input name="estimated_monthly_hours" type="number" defaultValue={lead.estimated_monthly_hours ?? ""} /></Field>
      <Field name="estimated_monthly_value" label="Est. value / month (€)"><Input name="estimated_monthly_value" type="number" step="0.01" defaultValue={lead.estimated_monthly_value ?? ""} /></Field>
      <Field name="next_follow_up_at" label="Next follow-up"><Input name="next_follow_up_at" type="datetime-local" defaultValue={toLocal(lead.next_follow_up_at)} /></Field>
    </div>
  );

  return (
    <>
      <Link href="/admin/crm" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> CRM</Link>
      <PageHeader title={lead.company_name} description={lead.contact_name ?? undefined} actions={<StatusBadge status={lead.stage} />} />
      {lead.stage === "lost" && <Alert tone="danger" title="Lost" className="mb-4">{lead.lost_reason}</Alert>}
      {lead.converted_client_id && <Alert tone="success" className="mb-4">Converted to a client. <Link className="underline" href={`/admin/clients/${lead.converted_client_id}`}>Open client</Link></Alert>}

      {canWrite && !lead.converted_client_id && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap items-center gap-2 pt-5">
            <span className="mr-2 text-sm text-muted-foreground">Move to:</span>
            {STAGES.filter((s) => s !== lead.stage && s !== "won").map((s) => (
              <ConfirmAction key={s} action={setLeadStageAction} fields={{ id, stage: s }} title={`Move to ${humanize(s)}?`} withReason={s === "lost" ? "Why was the lead lost?" : undefined} variant={s === "lost" ? "ghost" : "secondary"} destructive={s === "lost"}>
                {humanize(s)}
              </ConfirmAction>
            ))}
            {ctx.can("clients.write") && (
              <ConfirmAction action={convertLeadAction} fields={{ id }} title="Convert to client?" description="Creates a client (and primary contact) from this lead and marks it won." confirmLabel="Convert" variant="default">Won → create client</ConfirmAction>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {canWrite && (
                <ServerForm action={addActivityAction.bind(null, id)} submitLabel="Log activity" resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-3" footerClassName="sm:col-span-3">
                  <Field name="activity_type" label="Type"><NativeSelect name="activity_type" defaultValue="note">{["note", "call", "email", "meeting", "task"].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</NativeSelect></Field>
                  <Field name="subject" label="Subject"><Input name="subject" /></Field>
                  <Field name="due_at" label="Due (tasks)"><Input name="due_at" type="datetime-local" /></Field>
                  <Field name="body" label="Notes" className="sm:col-span-3"><Textarea name="body" rows={2} /></Field>
                </ServerForm>
              )}
              {!activities.data?.length ? <EmptyState icon={History} title="No activity yet" /> : (
                <ul className="divide-y divide-border">
                  {activities.data.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                      <div>
                        <p><Badge>{humanize(a.activity_type)}</Badge> <span className="font-medium">{a.subject}</span></p>
                        {a.body && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.body}</p>}
                        <p className="mt-1 text-xs text-muted-foreground">{a.profiles?.full_name ?? a.profiles?.email ?? "System"} · {formatDateTime(a.created_at)}{a.due_at ? ` · due ${formatDateTime(a.due_at)}` : ""}{a.completed_at ? " · done" : ""}</p>
                      </div>
                      {canWrite && a.activity_type === "task" && !a.completed_at && (
                        <ConfirmAction action={completeActivityAction} fields={{ id: a.id }} title="Complete task?" variant="soft">Done</ConfirmAction>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Lead details</CardTitle></CardHeader>
            <CardContent>{canWrite ? <ServerForm action={updateLeadAction.bind(null, id)}>{fields}</ServerForm> : <fieldset disabled>{fields}</fieldset>}</CardContent>
          </Card>
          {canWrite && (
            <Card>
              <CardHeader><CardTitle>Owner</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {owners.map(([uid, name]) => (
                  <ConfirmAction key={uid} action={setLeadOwnerAction} fields={{ id, owner_id: uid }} title={`Assign to ${name}?`} variant={uid === lead.owner_id ? "soft" : "ghost"}>{uid === lead.owner_id ? "✓ " : ""}{name}</ConfirmAction>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
