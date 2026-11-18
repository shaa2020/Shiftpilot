import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Scale, ShieldCheck } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDate, nowMs } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { createRuleAction, decideReviewAction, requestPositionReviewAction, setRuleStatusAction } from "./actions";

export const metadata: Metadata = { title: "Compliance" };
const TABS = { expiring: "Expiring evidence", reviews: "Compliance reviews", rules: "Rules" } as const;
type Tab = keyof typeof TABS;
const CATEGORIES = ["work_eligibility", "classification", "working_time", "minimum_wage", "equal_treatment", "certification", "health_safety", "registration", "other"];

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff("compliance.read");
  const { tab: raw } = await searchParams;
  const tab: Tab = raw && raw in TABS ? (raw as Tab) : "expiring";
  return (
    <>
      <PageHeader title="Compliance" description="ShiftPilot records checks and human decisions. It does not give legal advice; rule parameters must come from an authoritative source reviewed by your compliance adviser." />
      <SectionTabs tabs={Object.entries(TABS).map(([k, l]) => ({ key: k, label: l, href: `?tab=${k}` }))} active={tab} />
      {tab === "expiring" && <Expiring agencyId={ctx.agencyId} />}
      {tab === "reviews" && <Reviews agencyId={ctx.agencyId} canDecide={ctx.can("compliance.review")} />}
      {tab === "rules" && <Rules agencyId={ctx.agencyId} canEdit={ctx.can("compliance.review")} />}
    </>
  );
}

async function Expiring({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const horizon = localDate(new Date(nowMs() + 60 * 86400000));
  const today = localDate(new Date());
  const { data } = await supabase.from("document_expiries").select("*").eq("agency_id", agencyId).lte("expires_on", horizon).not("status", "in", "(rejected,not_submitted)").order("expires_on").limit(500);
  const ids = [...new Set((data ?? []).map((r) => r.worker_id).filter(Boolean))] as string[];
  const { data: workers } = ids.length ? await supabase.from("workers").select("id, first_name, last_name").in("id", ids) : { data: [] };
  const names = new Map((workers ?? []).map((w) => [w.id, `${w.first_name} ${w.last_name}`]));
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle>Expired or expiring within 60 days</CardTitle><CardDescription>Expired certificates stop counting for shift eligibility automatically.</CardDescription></CardHeader>
      {!data?.length ? <EmptyState icon={CalendarClock} title="Nothing expiring in the next 60 days" className="m-5" /> : (
        <Table>
          <THead><tr><TH>Evidence</TH><TH>Worker</TH><TH>Expires</TH><TH>Status</TH></tr></THead>
          <TBody>
            {data.map((r) => (
              <TR key={`${r.source}-${r.record_id}`}>
                <TD><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{humanize(r.source ?? "")}</p></TD>
                <TD>{r.worker_id ? <Link className="hover:underline" href={`/admin/workers/${r.worker_id}?tab=${r.source === "document" ? "documents" : "compliance"}`}>{names.get(r.worker_id) ?? "Worker"}</Link> : "—"}</TD>
                <TD className={r.expires_on && r.expires_on < today ? "font-medium text-danger" : "text-warning"}>{r.expires_on}{r.expires_on && r.expires_on < today ? " (expired)" : ""}</TD>
                <TD><StatusBadge status={r.status ?? "pending"} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

async function Reviews({ agencyId, canDecide }: { agencyId: string; canDecide: boolean }) {
  const supabase = await createClient();
  const [{ data: reviews }, { data: workers }, { data: positions }] = await Promise.all([
    supabase.from("compliance_reviews").select("id, review_type, status, rationale, valid_until, restrictions, questionnaire, created_at, decided_at, worker_id, workers(first_name, last_name), job_positions(name), freelancer_businesses(trade_name)").eq("agency_id", agencyId).order("status").order("created_at", { ascending: false }).limit(200),
    canDecide ? supabase.from("workers").select("id, first_name, last_name").eq("agency_id", agencyId).in("status", ["onboarding", "active"]).order("last_name").limit(1000) : Promise.resolve({ data: [] }),
    canDecide ? supabase.from("job_positions").select("id, name").eq("agency_id", agencyId).eq("is_regulated", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        {!reviews?.length ? <EmptyState icon={Scale} title="No compliance reviews" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Review</TH><TH>Subject</TH><TH>Outcome</TH><TH className="w-[28rem]">Decision</TH></tr></THead>
            <TBody>
              {reviews.map((r) => (
                <TR key={r.id}>
                  <TD><p className="font-medium">{humanize(r.review_type)}</p><p className="text-xs text-muted-foreground">Opened {formatDate(r.created_at)}</p></TD>
                  <TD>
                    {r.workers && <Link className="hover:underline" href={`/admin/workers/${r.worker_id}?tab=compliance`}>{r.workers.first_name} {r.workers.last_name}</Link>}
                    {r.freelancer_businesses && <p className="text-xs text-muted-foreground">{r.freelancer_businesses.trade_name}</p>}
                    {r.job_positions && <p className="text-xs text-muted-foreground">Position: {r.job_positions.name}</p>}
                  </TD>
                  <TD><StatusBadge status={r.status} />{r.valid_until && <p className="text-xs text-muted-foreground">until {r.valid_until}</p>}</TD>
                  <TD>
                    {r.status !== "pending" ? <p className="text-sm text-muted-foreground">{r.rationale}{r.decided_at ? ` (${formatDate(r.decided_at)})` : ""}</p>
                      : canDecide && r.review_type !== "freelancer_classification" ? (
                        <ServerForm action={decideReviewAction} submitLabel="Record decision" className="grid grid-cols-1 gap-2 sm:grid-cols-2" footerClassName="sm:col-span-2">
                          <input type="hidden" name="id" value={r.id} />
                          <Field name="outcome" label="Outcome"><NativeSelect name="outcome" defaultValue="approved"><option value="approved">Approved</option><option value="restricted">Restricted</option><option value="rejected">Rejected</option></NativeSelect></Field>
                          <Field name="valid_until" label="Valid until"><Input name="valid_until" type="date" /></Field>
                          <Field name="max_hours_per_week" label="Max hours/week (if restricted)"><Input name="max_hours_per_week" inputMode="numeric" /></Field>
                          <div className="sm:col-span-2"><Field name="rationale" label="Rationale"><Textarea name="rationale" rows={2} required minLength={10} /></Field></div>
                        </ServerForm>
                      ) : r.review_type === "freelancer_classification" ? <Link className="text-sm text-primary hover:underline" href={`/admin/workers/${r.worker_id}?tab=pathway`}>Decide on the worker&apos;s pathway tab</Link> : <span className="text-sm text-muted-foreground">Awaiting decision</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {canDecide && (
        <Card>
          <CardHeader><CardTitle>Open a regulated-position review</CardTitle><CardDescription>Workers can only be matched to positions marked regulated after an approved review.</CardDescription></CardHeader>
          <CardContent>
            {!positions?.length ? <p className="text-sm text-muted-foreground">No positions are marked as regulated. Set this under <Link className="text-primary hover:underline" href="/admin/configuration?tab=positions">Configuration</Link>.</p> : (
              <ServerForm action={requestPositionReviewAction} submitLabel="Open review" resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-3" footerClassName="sm:col-span-3">
                <Field name="worker_id" label="Worker"><NativeSelect name="worker_id" defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...(workers ?? []).map((w) => <option key={w.id} value={w.id}>{w.last_name}, {w.first_name}</option>)]}</NativeSelect></Field>
                <Field name="position_id" label="Position"><NativeSelect name="position_id" defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</NativeSelect></Field>
                <Field name="notes" label="Notes"><Input name="notes" /></Field>
              </ServerForm>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Rules({ agencyId, canEdit }: { agencyId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data: rules } = await supabase.from("compliance_rules").select("*").eq("agency_id", agencyId).order("rule_key").order("version", { ascending: false });
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Configured rules</CardTitle>
          <CardDescription>
            Active rules are enforced during shift matching. Recognised keys: <code>working_time.max_shift</code> (<code>max_shift_minutes</code>), <code>working_time.min_rest</code> (<code>min_rest_minutes</code>), <code>working_time.max_weekly</code> (<code>max_weekly_minutes</code>). Other rules are recorded for reference. Active versions cannot be edited — create a new version.
          </CardDescription>
        </CardHeader>
        {!rules?.length ? <EmptyState icon={ShieldCheck} title="No rules configured" description="No working-time limits are enforced until you add and activate them." className="m-5" /> : (
          <Table>
            <THead><tr><TH>Rule</TH><TH>Parameters</TH><TH>Effective</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD><p className="font-medium">{r.name} <span className="text-xs text-muted-foreground">v{r.version}</span></p><p className="text-xs text-muted-foreground"><code>{r.rule_key}</code> · {humanize(r.category)} · {r.severity}</p><p className="text-xs text-muted-foreground">Source: {r.source_reference}</p></TD>
                  <TD><code className="text-xs">{JSON.stringify(r.parameters)}</code></TD>
                  <TD className="text-muted-foreground">{r.effective_from} → {r.effective_to ?? "open"}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {canEdit && r.status === "draft" && <ConfirmAction action={setRuleStatusAction} fields={{ id: r.id, status: "active" }} title="Activate this rule?" description="Confirm the parameters were checked against the cited source. Any open-ended previous version is closed the day before." confirmLabel="Activate">Activate</ConfirmAction>}
                    {canEdit && r.status === "active" && <ConfirmAction action={setRuleStatusAction} fields={{ id: r.id, status: "retired" }} title="Retire this rule?" description="It stops being enforced from today." destructive variant="ghost" confirmLabel="Retire">Retire</ConfirmAction>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {canEdit && (
        <Card>
          <CardHeader><CardTitle>New rule or new version</CardTitle><CardDescription>Using an existing key creates the next version as a draft.</CardDescription></CardHeader>
          <CardContent>
            <ServerForm action={createRuleAction} submitLabel="Create draft" resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-2" footerClassName="sm:col-span-2">
              <Field name="rule_key" label="Rule key"><Input name="rule_key" placeholder="working_time.max_shift" /></Field>
              <Field name="name" label="Name"><Input name="name" /></Field>
              <Field name="category" label="Category"><NativeSelect name="category" defaultValue="working_time">{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</NativeSelect></Field>
              <Field name="severity" label="Severity"><NativeSelect name="severity" defaultValue="blocking"><option value="blocking">Blocking</option><option value="warning">Warning</option><option value="informational">Informational</option></NativeSelect></Field>
              <Field name="parameters" label="Parameters (JSON)"><Input name="parameters" placeholder='{"max_shift_minutes": 720}' /></Field>
              <Field name="effective_from" label="Effective from"><Input name="effective_from" type="date" /></Field>
              <div className="sm:col-span-2"><Field name="source_reference" label="Authoritative source"><Input name="source_reference" placeholder="Law/CAO article and version, checked by…" /></Field></div>
              <div className="sm:col-span-2"><Field name="description" label="Description"><Textarea name="description" rows={2} /></Field></div>
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
