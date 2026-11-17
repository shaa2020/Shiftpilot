import type { Metadata } from "next";
import { Database, Lock, ShieldAlert, UserX } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, localDate } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import {
  anonymiseAction, createRequestAction, recordBreachAction, saveActivityAction, saveRetentionAction, updateBreachAction, updateRequestAction,
} from "./actions";

export const metadata: Metadata = { title: "Privacy" };
const TABS = { requests: "Subject requests", erasure: "Anonymisation", register: "Processing register", retention: "Retention", breaches: "Breaches" } as const;
type Tab = keyof typeof TABS;
const REQUEST_TYPES = ["access", "export", "rectification", "erasure", "restriction", "objection"];
const BASES = ["consent", "contract", "legal_obligation", "vital_interests", "public_task", "legitimate_interests"];

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff("gdpr.manage");
  const { tab: raw } = await searchParams;
  const tab: Tab = raw && raw in TABS ? (raw as Tab) : "requests";
  return (
    <>
      <PageHeader title="Privacy" description="Tools to handle GDPR obligations. They support, but do not replace, review by your privacy officer or legal adviser." />
      <SectionTabs tabs={Object.entries(TABS).map(([k, l]) => ({ key: k, label: l, href: `?tab=${k}` }))} active={tab} />
      {tab === "requests" && <Requests agencyId={ctx.agencyId} />}
      {tab === "erasure" && <Erasure agencyId={ctx.agencyId} />}
      {tab === "register" && <Register agencyId={ctx.agencyId} />}
      {tab === "retention" && <Retention agencyId={ctx.agencyId} />}
      {tab === "breaches" && <Breaches agencyId={ctx.agencyId} />}
    </>
  );
}

async function Requests({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("data_subject_requests").select("*").eq("agency_id", agencyId).order("status").order("due_at").limit(300);
  const now = new Date().toISOString();
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={Lock} title="No data subject requests" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Subject</TH><TH>Request</TH><TH>Due</TH><TH>Status</TH><TH className="w-[26rem]">Handle</TH></tr></THead>
            <TBody>
              {data.map((r) => {
                const open = !["completed", "rejected"].includes(r.status);
                return (
                  <TR key={r.id}>
                    <TD><p className="font-medium">{r.subject_email}</p><p className="text-xs text-muted-foreground">Received {formatDate(r.created_at)}{r.subject_user_id ? " · self-service" : ""}</p></TD>
                    <TD>{humanize(r.request_type)}{r.details && <p className="max-w-xs text-xs text-muted-foreground">{r.details}</p>}</TD>
                    <TD className={open && r.due_at < now ? "font-medium text-danger" : "text-muted-foreground"}>{formatDate(r.due_at)}</TD>
                    <TD><StatusBadge status={r.status} />{r.outcome && <p className="text-xs text-muted-foreground">{r.outcome}</p>}</TD>
                    <TD>
                      <a className="mb-2 inline-block text-sm text-primary hover:underline" href={`/api/privacy/export?email=${encodeURIComponent(r.subject_email)}`}>Download data export (JSON)</a>
                      {open && (
                        <ServerForm action={updateRequestAction} submitLabel="Update" className="grid gap-2 sm:grid-cols-2" footerClassName="sm:col-span-2">
                          <input type="hidden" name="id" value={r.id} />
                          <Field name="status" label="Status"><NativeSelect name="status" defaultValue={r.status === "received" ? "verifying" : r.status}>{["verifying", "in_progress", "completed", "rejected"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</NativeSelect></Field>
                          <Field name="retained" label="Retained records" hint="Comma-separated, e.g. payroll (7 yrs)"><Input name="retained" /></Field>
                          <div className="sm:col-span-2"><Field name="outcome" label="Outcome (required to close)"><Textarea name="outcome" rows={2} /></Field></div>
                        </ServerForm>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Log a request</CardTitle><CardDescription>Verify the requester&apos;s identity before releasing any data. Erasure requests are handled on the Anonymisation tab; records under legal retention stay.</CardDescription></CardHeader>
        <CardContent>
          <ServerForm action={createRequestAction} submitLabel="Log request" resetOnSuccess className="grid gap-3 sm:grid-cols-3" footerClassName="sm:col-span-3">
            <Field name="subject_email" label="Subject email"><Input name="subject_email" type="email" /></Field>
            <Field name="request_type" label="Type"><NativeSelect name="request_type" defaultValue="access">{REQUEST_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</NativeSelect></Field>
            <Field name="details" label="Details"><Input name="details" /></Field>
          </ServerForm>
        </CardContent>
      </Card>
    </div>
  );
}

async function Erasure({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const [{ data: workers }, { data: apps }] = await Promise.all([
    supabase.from("workers").select("id, first_name, last_name, worker_number, status, updated_at").eq("agency_id", agencyId).in("status", ["inactive", "archived"]).not("email", "like", "anonymised+%").order("updated_at").limit(200),
    supabase.from("applications").select("id, first_name, last_name, email, status, retention_until, created_at").eq("agency_id", agencyId).is("worker_id", null).not("email", "like", "anonymised+%").in("status", ["rejected", "withdrawn"]).order("retention_until").limit(200),
  ]);
  const today = localDate(new Date());
  const button = (kind: string, id: string, name: string) => (
    <ConfirmAction action={anonymiseAction} fields={{ kind, id }} title={`Anonymise ${name}?`} description="Names, contact details, addresses, notes, availability and location data are removed permanently. Contracts, timesheets, payroll and invoices stay for legal retention but no longer identify the person. This cannot be undone." destructive variant="ghost" confirmLabel="Anonymise">Anonymise</ConfirmAction>
  );
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Inactive workers</CardTitle><CardDescription>Only inactive or archived workers without open assignments can be anonymised.</CardDescription></CardHeader>
        {!workers?.length ? <EmptyState icon={UserX} title="No inactive workers with personal data" className="m-5" /> : (
          <Table><TBody>{workers.map((w) => <TR key={w.id}><TD>{w.first_name} {w.last_name}<p className="text-xs text-muted-foreground">{w.worker_number} · {humanize(w.status)} since {formatDate(w.updated_at)}</p></TD><TD className="text-right">{button("worker", w.id, `${w.first_name} ${w.last_name}`)}</TD></TR>)}</TBody></Table>
        )}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Closed applications</CardTitle><CardDescription>Applications past their retention date are anonymised automatically by the scheduled retention job.</CardDescription></CardHeader>
        {!apps?.length ? <EmptyState icon={UserX} title="No closed applications with personal data" className="m-5" /> : (
          <Table><TBody>{apps.map((a) => <TR key={a.id}><TD>{a.first_name} {a.last_name}<p className="text-xs text-muted-foreground">{a.email} · {humanize(a.status)} · keep until <span className={a.retention_until < today ? "text-danger" : ""}>{a.retention_until}</span></p></TD><TD className="text-right">{button("application", a.id, `${a.first_name} ${a.last_name}`)}</TD></TR>)}</TBody></Table>
        )}
      </Card>
    </div>
  );
}

async function Register({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("processing_activities").select("*").eq("agency_id", agencyId).order("name").order("version", { ascending: false });
  const seen = new Set<string>();
  const current = (data ?? []).filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true)));
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Record of processing activities</CardTitle><CardDescription>Article 30 register. Saving an activity with an existing name creates a new version; history is kept.</CardDescription></CardHeader>
        {!current.length ? <EmptyState icon={Database} title="No processing activities recorded" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Activity</TH><TH>Lawful basis</TH><TH>Data</TH><TH>Retention</TH></tr></THead>
            <TBody>
              {current.map((a) => (
                <TR key={a.id}>
                  <TD><p className="font-medium">{a.name} <span className="text-xs text-muted-foreground">v{a.version}</span></p><p className="max-w-sm text-xs text-muted-foreground">{a.purpose}</p></TD>
                  <TD>{humanize(a.lawful_basis)}</TD>
                  <TD className="text-xs text-muted-foreground">{a.data_categories.join(", ")}<br />Subjects: {a.data_subjects.join(", ")}{a.processors ? <><br />Processors: {a.processors}</> : null}</TD>
                  <TD className="max-w-xs text-xs text-muted-foreground">{a.retention_description}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Add or update an activity</CardTitle></CardHeader>
        <CardContent>
          <ServerForm action={saveActivityAction} submitLabel="Save activity" resetOnSuccess className="grid gap-3 sm:grid-cols-2" footerClassName="sm:col-span-2">
            <Field name="name" label="Name"><Input name="name" placeholder="Shift scheduling" /></Field>
            <Field name="lawful_basis" label="Lawful basis"><NativeSelect name="lawful_basis" defaultValue="contract">{BASES.map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</NativeSelect></Field>
            <div className="sm:col-span-2"><Field name="purpose" label="Purpose"><Textarea name="purpose" rows={2} /></Field></div>
            <Field name="data_categories" label="Data categories" hint="Comma-separated"><Input name="data_categories" placeholder="contact details, availability" /></Field>
            <Field name="data_subjects" label="Data subjects" hint="Comma-separated"><Input name="data_subjects" placeholder="workers, client contacts" /></Field>
            <Field name="recipients" label="Recipients"><Input name="recipients" /></Field>
            <Field name="processors" label="Processors"><Input name="processors" placeholder="Supabase (hosting), Resend (email)" /></Field>
            <Field name="retention_description" label="Retention"><Input name="retention_description" /></Field>
            <Field name="security_measures" label="Security measures"><Input name="security_measures" /></Field>
          </ServerForm>
        </CardContent>
      </Card>
    </div>
  );
}

async function Retention({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("data_retention_records").select("*").eq("agency_id", agencyId).order("data_category");
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Retention schedule</CardTitle><CardDescription>Applicant data is anonymised automatically once its retention date passes (daily job). Other categories are documented here; periods must be confirmed by your adviser.</CardDescription></CardHeader>
        {!data?.length ? <EmptyState icon={Database} title="No retention periods recorded" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Category</TH><TH>Table</TH><TH>Period</TH><TH>Action</TH><TH>Last run</TH></tr></THead>
            <TBody>
              {data.map((r) => (
                <TR key={r.id}>
                  <TD><p className="font-medium">{r.data_category}</p><p className="text-xs text-muted-foreground">{r.legal_basis}</p></TD>
                  <TD><code className="text-xs">{r.table_name}</code></TD>
                  <TD>{r.retention_months} months</TD>
                  <TD>{humanize(r.action)}</TD>
                  <TD className="text-muted-foreground">{r.last_run_at ? `${formatDateTime(r.last_run_at)} (${r.last_run_affected ?? 0})` : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Set a retention period</CardTitle></CardHeader>
        <CardContent>
          <ServerForm action={saveRetentionAction} submitLabel="Save" resetOnSuccess className="grid gap-3 sm:grid-cols-3" footerClassName="sm:col-span-3">
            <Field name="data_category" label="Category"><Input name="data_category" placeholder="Rejected applicants" /></Field>
            <Field name="table_name" label="Table"><Input name="table_name" placeholder="applications" /></Field>
            <Field name="retention_months" label="Months"><Input name="retention_months" type="number" min={1} max={1200} /></Field>
            <Field name="action" label="Action"><NativeSelect name="action" defaultValue="anonymise"><option value="anonymise">Anonymise</option><option value="delete">Delete</option><option value="archive">Archive</option></NativeSelect></Field>
            <div className="sm:col-span-2"><Field name="legal_basis" label="Basis for the period"><Input name="legal_basis" /></Field></div>
          </ServerForm>
        </CardContent>
      </Card>
    </div>
  );
}

async function Breaches({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("breach_records").select("*").eq("agency_id", agencyId).order("detected_at", { ascending: false }).limit(200);
  const deadline = (d: string) => new Date(new Date(d).getTime() + 72 * 3600000);
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Breach register</CardTitle><CardDescription>Every personal data breach is recorded, including ones not reported to the authority.</CardDescription></CardHeader>
        {!data?.length ? <EmptyState icon={ShieldAlert} title="No breaches recorded" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Detected</TH><TH>Description</TH><TH>Reporting</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
            <TBody>
              {data.map((b) => (
                <TR key={b.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(b.detected_at)}{!b.reported_to_authority_at && b.status !== "closed" && <p className="text-xs text-warning">72 h assessment: {formatDateTime(deadline(b.detected_at).toISOString())}</p>}</TD>
                  <TD className="max-w-sm"><p>{b.description}</p><p className="text-xs text-muted-foreground">{b.data_categories.join(", ")}{b.approx_subjects ? ` · ~${b.approx_subjects} people` : ""}</p>{b.measures_taken && <p className="text-xs text-muted-foreground">Measures: {b.measures_taken}</p>}</TD>
                  <TD className="text-xs text-muted-foreground">Authority: {b.reported_to_authority_at ? formatDateTime(b.reported_to_authority_at) : "not reported"}<br />Subjects: {b.subjects_notified_at ? formatDateTime(b.subjects_notified_at) : "not notified"}</TD>
                  <TD><StatusBadge status={b.status} /></TD>
                  <TD className="space-y-1 text-right">
                    {!b.reported_to_authority_at && <ConfirmAction action={updateBreachAction} fields={{ id: b.id, field: "reported" }} title="Mark as reported to the authority?" confirmLabel="Mark reported" variant="ghost">Reported</ConfirmAction>}
                    {!b.subjects_notified_at && <ConfirmAction action={updateBreachAction} fields={{ id: b.id, field: "notified" }} title="Mark affected people as notified?" confirmLabel="Mark notified" variant="ghost">Notified</ConfirmAction>}
                    {b.status === "open" && <ConfirmAction action={updateBreachAction} fields={{ id: b.id, field: "contained" }} title="Mark as contained?" withReason="Measures taken" reasonOptional confirmLabel="Contained" variant="ghost">Contained</ConfirmAction>}
                    {b.status !== "closed" && <ConfirmAction action={updateBreachAction} fields={{ id: b.id, field: "closed" }} title="Close this breach?" withReason="Measures taken" reasonOptional confirmLabel="Close" variant="ghost">Close</ConfirmAction>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Record a breach</CardTitle></CardHeader>
        <CardContent>
          <ServerForm action={recordBreachAction} submitLabel="Record breach" resetOnSuccess className="grid gap-3 sm:grid-cols-2" footerClassName="sm:col-span-2">
            <Field name="detected_at" label="Detected at"><Input name="detected_at" type="datetime-local" /></Field>
            <Field name="approx_subjects" label="Approx. people affected"><Input name="approx_subjects" inputMode="numeric" /></Field>
            <div className="sm:col-span-2"><Field name="description" label="What happened"><Textarea name="description" rows={2} /></Field></div>
            <Field name="data_categories" label="Data categories" hint="Comma-separated"><Input name="data_categories" /></Field>
            <Field name="risk_assessment" label="Risk assessment"><Input name="risk_assessment" /></Field>
          </ServerForm>
        </CardContent>
      </Card>
    </div>
  );
}
