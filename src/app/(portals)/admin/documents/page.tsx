import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarX, FileCheck, FileClock, FileSearch, FileText, FolderOpen, Send, ShieldCheck } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDate, localDate } from "@/lib/time";
import { documentState, dueLabel, REQUEST_STATUS } from "@/lib/documents/format";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { SectionTabs } from "@/components/ui/detail";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { RequestDocumentForm } from "@/components/documents/request-form";
import { cn } from "@/lib/utils";
import {
  cancelRequestAction, createDocumentTypeAction, remindRequestAction, requestDocumentsAction, toggleDocumentTypeAction, verifyDocumentAction,
} from "./actions";

export const metadata: Metadata = { title: "Documents" };

const TABS = ["review", "requests", "expiring", "library", "types"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { review: "To review", requests: "Requests", expiring: "Expiring", library: "All documents", types: "Document types" };
const REQUEST_FILTERS = ["open", "overdue", "submitted", "completed", "cancelled", "all"] as const;
const LIB_STATUS = ["pending", "verified", "rejected", "expired"] as const;

type SP = { tab?: string; filter?: string; q?: string; type?: string; status?: string };

function ownerName(w: { first_name: string; last_name: string } | null | undefined, c: { name: string } | null | undefined) {
  return w ? `${w.first_name} ${w.last_name}` : c?.name ?? "Agency";
}

export default async function DocumentsHubPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaff("documents.read");
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "review";
  const supabase = await createClient();
  const today = localDate(new Date());
  const soon = addDays(today, 30);
  const head = { count: "exact" as const, head: true };
  const [review, open, overdue, expiring] = await Promise.all([
    supabase.from("documents").select("id", head).eq("agency_id", ctx.agencyId).is("archived_at", null).eq("status", "pending").gt("current_version", 0),
    supabase.from("document_requests").select("id", head).eq("agency_id", ctx.agencyId).in("status", ["open", "submitted"]),
    supabase.from("document_requests").select("id", head).eq("agency_id", ctx.agencyId).eq("status", "open").lt("due_on", today),
    supabase.from("documents").select("id", head).eq("agency_id", ctx.agencyId).is("archived_at", null).eq("status", "verified").lte("expires_on", soon),
  ]);

  return (
    <>
      <PageHeader title="Documents" description="Review uploads, request documents from workers, track expiry and keep every file with its full history." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="?tab=review"><StatCard label="To review" value={review.count ?? 0} icon={FileSearch} tone={review.count ? "info" : "neutral"} /></Link>
        <Link href="?tab=requests&filter=open"><StatCard label="Open requests" value={open.count ?? 0} icon={Send} tone="neutral" /></Link>
        <Link href="?tab=requests&filter=overdue"><StatCard label="Overdue" value={overdue.count ?? 0} icon={AlarmClock} tone={overdue.count ? "danger" : "neutral"} /></Link>
        <Link href="?tab=expiring"><StatCard label="Expiring in 30 days" value={expiring.count ?? 0} icon={CalendarX} tone={expiring.count ? "warning" : "neutral"} /></Link>
      </div>
      <SectionTabs tabs={TABS.map((t) => ({ key: t, label: LABELS[t], href: `?tab=${t}` }))} active={tab} />
      {tab === "review" && <Review agencyId={ctx.agencyId} canVerify={ctx.can("documents.verify")} />}
      {tab === "requests" && <Requests agencyId={ctx.agencyId} filter={sp.filter} today={today} canRequest={ctx.can("documents.upload")} />}
      {tab === "expiring" && <Expiring agencyId={ctx.agencyId} today={today} canRequest={ctx.can("documents.upload")} />}
      {tab === "library" && <Library agencyId={ctx.agencyId} sp={sp} today={today} />}
      {tab === "types" && <Types agencyId={ctx.agencyId} canManage={ctx.can("agency.settings.manage")} />}
    </>
  );
}

async function Review({ agencyId, canVerify }: { agencyId: string; canVerify: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, title, expires_on, current_version, updated_at, worker_id, client_id, document_types(name, requires_expiry, is_sensitive), workers(first_name, last_name, worker_number), clients(name), document_versions(version, scan_status, created_at, file_name)")
    .eq("agency_id", agencyId).is("archived_at", null).eq("status", "pending").gt("current_version", 0)
    .order("updated_at", { ascending: true }).limit(200);
  if (!data?.length) return <EmptyState icon={FileCheck} title="Nothing waiting for review" description="New uploads from workers appear here. You are notified when one arrives." />;
  return (
    <ul className="space-y-3">
      {data.map((d) => {
        const v = d.document_versions.find((x) => x.version === d.current_version);
        return (
          <li key={d.id}>
            <Card>
              <CardContent className="flex flex-col gap-4 pt-5 md:flex-row md:items-center">
                <Link href={`/admin/documents/${d.id}`} className="flex min-w-0 flex-1 gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground"><FileText className="size-5" aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {d.title}
                      {d.current_version > 1 && <Badge>v{d.current_version}</Badge>}
                      {d.document_types?.is_sensitive && <Badge tone="warning"><ShieldCheck className="size-3" aria-hidden /> Sensitive</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">{ownerName(d.workers, d.clients)}{d.workers ? ` · ${d.workers.worker_number}` : ""} · {d.document_types?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Uploaded {v ? formatDate(v.created_at) : formatDate(d.updated_at)}{v?.file_name ? ` · ${v.file_name}` : ""}
                      {v?.scan_status && <span className={v.scan_status === "clean" ? " text-success" : " text-warning"}> · {v.scan_status === "clean" ? "virus scan clean" : "not virus-scanned"}</span>}
                    </p>
                  </div>
                </Link>
                <div className="flex flex-wrap items-end gap-2 md:justify-end">
                  <Button asChild variant="secondary" size="sm"><Link href={`/admin/documents/${d.id}`}>Open</Link></Button>
                  {canVerify && (
                    <>
                      <ServerForm action={verifyDocumentAction} submitLabel="Verify" pendingLabel="…" className="flex items-end gap-2 space-y-0" footerClassName="m-0">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="approve" value="true" />
                        {d.document_types?.requires_expiry && <label className="text-xs text-muted-foreground">Expires<Input name="expires_on" type="date" defaultValue={d.expires_on ?? ""} className="h-8 w-36" /></label>}
                      </ServerForm>
                      <ConfirmAction action={verifyDocumentAction} fields={{ id: d.id, approve: "false" }} title="Reject this document?" description="The worker is notified with your reason and can upload a new version." withReason="Reason shown to the worker" variant="ghost" destructive confirmLabel="Reject">Reject</ConfirmAction>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

async function Requests({ agencyId, filter: raw, today, canRequest }: { agencyId: string; filter?: string; today: string; canRequest: boolean }) {
  const filter = (REQUEST_FILTERS as readonly string[]).includes(raw ?? "") ? raw! : "open";
  const supabase = await createClient();
  let q = supabase
    .from("document_requests")
    .select("id, title, message, due_on, status, created_at, submitted_at, completed_at, last_reminded_at, cancel_reason, worker_id, document_id, workers(first_name, last_name, worker_number, user_id), document_types(name)")
    .eq("agency_id", agencyId).order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(300);
  if (filter === "overdue") q = q.eq("status", "open").lt("due_on", today);
  else if (filter !== "all") q = q.eq("status", filter);
  const [{ data }, { data: types }, { data: workers }] = await Promise.all([
    q,
    supabase.from("document_types").select("id, name").eq("agency_id", agencyId).eq("status", "active").eq("applies_to", "worker").order("name"),
    canRequest ? supabase.from("workers").select("id, first_name, last_name, worker_number").eq("agency_id", agencyId).neq("status", "archived").order("first_name").limit(2000) : Promise.resolve({ data: [] }),
  ]);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div>
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter requests">
          {REQUEST_FILTERS.map((f) => (
            <Link key={f} href={`?tab=requests&filter=${f}`} aria-current={f === filter ? "true" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm capitalize", f === filter ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground")}>
              {f === "submitted" ? "Uploaded" : f}
            </Link>
          ))}
        </div>
        {!data?.length ? <EmptyState icon={Send} title="No requests here" description={canRequest ? "Use the form to ask workers for a document." : undefined} /> : (
          <ul className="space-y-2">
            {data.map((r) => {
              const st = REQUEST_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              const due = r.status === "open" ? dueLabel(r.due_on, today) : null;
              return (
                <li key={r.id} className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{r.title}</p>
                      <p className="text-sm text-muted-foreground">
                        <Link href={`/admin/workers/${r.worker_id}?tab=documents`} className="hover:underline">{r.workers ? `${r.workers.first_name} ${r.workers.last_name}` : "Worker"}</Link>
                        {r.workers?.worker_number ? ` · ${r.workers.worker_number}` : ""} · {r.document_types?.name} · requested {formatDate(r.created_at)}
                      </p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {due && <Badge tone={due.overdue ? "danger" : "neutral"}>{due.label}</Badge>}
                  </div>
                  {r.message && <p className="mt-2 text-sm text-foreground/80">“{r.message}”</p>}
                  {!r.workers?.user_id && r.status === "open" && <p className="mt-2 text-xs text-warning">This worker has no portal account yet — upload the document for them or invite them first.</p>}
                  {r.cancel_reason && <p className="mt-1 text-xs text-muted-foreground">Cancelled: {r.cancel_reason}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="mr-auto text-xs text-muted-foreground">
                      {r.submitted_at && `Uploaded ${formatDate(r.submitted_at)}`}
                      {r.completed_at && ` · completed ${formatDate(r.completed_at)}`}
                      {r.last_reminded_at && r.status === "open" && `Reminded ${formatDate(r.last_reminded_at)}`}
                    </span>
                    <Button asChild size="sm" variant={r.status === "submitted" ? "default" : "ghost"}><Link href={`/admin/documents/${r.document_id}`}>{r.status === "submitted" ? "Review upload" : "View"}</Link></Button>
                    {canRequest && r.status === "open" && r.workers?.user_id && (
                      <ConfirmAction action={remindRequestAction} fields={{ id: r.id }} title="Send a reminder?" description="The worker gets a notification about this request." confirmLabel="Send reminder" variant="ghost">Remind</ConfirmAction>
                    )}
                    {canRequest && (r.status === "open" || r.status === "submitted") && (
                      <ConfirmAction action={cancelRequestAction} fields={{ id: r.id, worker_id: r.worker_id }} title="Cancel this request?" withReason="Reason (optional)" reasonOptional confirmLabel="Cancel request" destructive variant="ghost">Cancel</ConfirmAction>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {canRequest && (
        <Card className="lg:sticky lg:top-24 lg:self-start">
          <CardHeader>
            <CardTitle>Request a document</CardTitle>
            <CardDescription>Workers get a notification and see the request at the top of their documents.</CardDescription>
          </CardHeader>
          <CardContent>
            <RequestDocumentForm
              action={requestDocumentsAction}
              types={types ?? []}
              workers={(workers ?? []).map((w) => ({ id: w.id, name: `${w.first_name} ${w.last_name}`, number: w.worker_number ?? "" }))}
              minDate={today}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Expiring({ agencyId, today, canRequest }: { agencyId: string; today: string; canRequest: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, title, expires_on, status, worker_id, document_type_id, workers(first_name, last_name, worker_number), clients(name), document_types(name, applies_to)")
    .eq("agency_id", agencyId).is("archived_at", null).in("status", ["verified", "expired"]).not("expires_on", "is", null).lte("expires_on", addDays(today, 60))
    .order("expires_on").limit(300);
  if (!data?.length) return <EmptyState icon={FileClock} title="Nothing expires in the next 60 days" />;
  return (
    <ul className="space-y-2">
      {data.map((d) => {
        const expired = d.expires_on! < today;
        return (
          <li key={d.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
            <Link href={`/admin/documents/${d.id}`} className="min-w-0 flex-1">
              <p className="font-medium">{d.title}</p>
              <p className="text-sm text-muted-foreground">{ownerName(d.workers, d.clients)} · {d.document_types?.name}</p>
            </Link>
            <Badge tone={expired ? "danger" : "warning"}>{expired ? "Expired" : "Expires"} {formatDate(d.expires_on!)}</Badge>
            {canRequest && d.worker_id && d.document_types?.applies_to === "worker" && (
              <ConfirmAction action={requestDocumentsAction} fields={{ worker_ids: d.worker_id, document_type_id: d.document_type_id, title: d.title, message: `Your ${d.title} ${expired ? "has expired" : `expires on ${formatDate(d.expires_on!)}`}. Please upload a renewed version.` }}
                title="Ask for a renewed version?" description="The worker is notified and the upload goes onto this document as a new version." confirmLabel="Request renewal" variant="soft">
                Request renewal
              </ConfirmAction>
            )}
          </li>
        );
      })}
    </ul>
  );
}

async function Library({ agencyId, sp, today }: { agencyId: string; sp: SP; today: string }) {
  const supabase = await createClient();
  let q = supabase
    .from("documents")
    .select("id, title, status, expires_on, current_version, updated_at, worker_id, workers(first_name, last_name, worker_number), clients(name), document_types(name)")
    .eq("agency_id", agencyId).is("archived_at", null).gt("current_version", 0).order("updated_at", { ascending: false }).limit(300);
  if (sp.q) q = q.ilike("title", `%${sp.q.replace(/[%_,()]/g, "")}%`);
  if (sp.type && /^[0-9a-f-]{36}$/.test(sp.type)) q = q.eq("document_type_id", sp.type);
  if (sp.status && (LIB_STATUS as readonly string[]).includes(sp.status)) q = q.eq("status", sp.status as "pending");
  const [{ data }, { data: types }] = await Promise.all([q, supabase.from("document_types").select("id, name").eq("agency_id", agencyId).order("name")]);
  return (
    <>
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_10rem_auto]">
        <input type="hidden" name="tab" value="library" />
        <Input name="q" defaultValue={sp.q} placeholder="Search document name" aria-label="Search" />
        <NativeSelect name="type" defaultValue={sp.type ?? ""} aria-label="Type"><option value="">All types</option>{(types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
        <NativeSelect name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">Any status</option>{LIB_STATUS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}</NativeSelect>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {!data?.length ? <EmptyState icon={FolderOpen} title="No documents found" /> : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
          {data.map((d) => {
            const st = documentState(d, today);
            return (
              <li key={d.id}>
                <Link href={`/admin/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                  <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{ownerName(d.workers, d.clients)} · {d.document_types?.name} · v{d.current_version}{d.expires_on ? ` · expires ${formatDate(d.expires_on)}` : ""}</p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

async function Types({ agencyId, canManage }: { agencyId: string; canManage: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("document_types").select("id, name, applies_to, required_for_engagement, requires_expiry, is_sensitive, retention_months, status").eq("agency_id", agencyId).in("applies_to", ["worker", "freelancer_business"]).order("name");
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        {(data ?? []).map((t) => (
          <li key={t.id} className={cn("flex flex-wrap items-center gap-2 px-4 py-3", t.status !== "active" && "opacity-60")}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">{t.applies_to === "worker" ? "Worker document" : "Freelancer business document"}{t.retention_months ? ` · kept ${t.retention_months} months` : ""}</p>
            </div>
            {t.required_for_engagement?.length ? <Badge tone="warning">Required: {t.required_for_engagement.join(", ")}</Badge> : <Badge>Optional</Badge>}
            {t.requires_expiry && <Badge>Has expiry</Badge>}
            {t.is_sensitive && <Badge tone="danger">Sensitive</Badge>}
            {t.status !== "active" && <Badge>Hidden</Badge>}
            {canManage && (
              <ConfirmAction action={toggleDocumentTypeAction} fields={{ id: t.id, status: t.status === "active" ? "inactive" : "active" }}
                title={t.status === "active" ? `Hide ${t.name}?` : `Show ${t.name} again?`} description={t.status === "active" ? "It disappears from worker checklists; existing documents are kept." : undefined}
                confirmLabel={t.status === "active" ? "Hide" : "Show"} variant="ghost">{t.status === "active" ? "Hide" : "Show"}</ConfirmAction>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <Card className="lg:sticky lg:top-24 lg:self-start">
          <CardHeader><CardTitle>New document type</CardTitle><CardDescription>Appears in every worker&apos;s checklist.</CardDescription></CardHeader>
          <CardContent>
            <ServerForm action={createDocumentTypeAction} submitLabel="Add type" resetOnSuccess>
              <Field name="name" label="Name" required><Input name="name" maxLength={120} placeholder="e.g. Food hygiene certificate" /></Field>
              <Field name="applies_to" label="Belongs to">
                <NativeSelect name="applies_to" defaultValue="worker"><option value="worker">The worker</option><option value="freelancer_business">The freelancer&apos;s business</option></NativeSelect>
              </Field>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Required for</legend>
                <CheckboxField name="required_employee" label="Employees" />
                <CheckboxField name="required_freelancer" label="Freelancers" />
              </fieldset>
              <CheckboxField name="requires_expiry" label="Has an expiry date" description="Verifiers must enter it; you are warned before it expires." />
              <CheckboxField name="is_sensitive" label="Sensitive (identity, medical)" description="Only staff with sensitive-data access can open it." />
              <Field name="retention_months" label="Keep for (months)" hint="Optional. Used by the retention job."><Input name="retention_months" type="number" min={1} max={1200} inputMode="numeric" /></Field>
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
