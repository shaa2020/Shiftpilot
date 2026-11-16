import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Inbox, Megaphone } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { ListFilters, ilikePattern } from "@/components/ui/list-filters";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { createOpeningAction, setOpeningStatusAction } from "./actions";

export const metadata: Metadata = { title: "Recruitment" };
const STATUSES = ["new", "screening", "interview", "assessment", "offer", "onboarding", "hired", "rejected", "withdrawn"];

export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; status?: string }> }) {
  const ctx = await requireStaff("recruitment.read");
  const { tab = "applications", q, status } = await searchParams;
  const supabase = await createClient();
  const { data: agency } = await supabase.from("agencies").select("slug").eq("id", ctx.agencyId).single();

  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Job openings, applications and hiring pipeline."
        actions={agency && <Link href={`/recruitment/${agency.slug}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" target="_blank">Public careers page <ExternalLink className="size-3.5" aria-hidden /></Link>}
      />
      <SectionTabs tabs={[{ key: "applications", label: "Applications", href: "?tab=applications" }, { key: "openings", label: "Job openings", href: "?tab=openings" }]} active={tab === "openings" ? "openings" : "applications"} />
      {tab === "openings" ? <Openings agencyId={ctx.agencyId} canWrite={ctx.can("recruitment.write")} /> : <Applications agencyId={ctx.agencyId} q={q} status={status} />}
    </>
  );
}

async function Applications({ agencyId, q, status }: { agencyId: string; q?: string; status?: string }) {
  const supabase = await createClient();
  let query = supabase.from("applications").select("id, first_name, last_name, email, city, status, source, created_at, job_openings(title)").eq("agency_id", agencyId).order("created_at", { ascending: false }).limit(300);
  if (status && STATUSES.includes(status)) query = query.eq("status", status as "new");
  else query = query.not("status", "in", "(hired,rejected,withdrawn)");
  if (q) { const p = ilikePattern(q); query = query.or(`first_name.ilike.${p},last_name.ilike.${p},email.ilike.${p}`); }
  const [{ data: apps }, { data: counts }] = await Promise.all([query, supabase.from("applications").select("status").eq("agency_id", agencyId)]);
  const by = (s: string) => (counts ?? []).filter((c) => c.status === s).length;
  const total = counts?.length ?? 0;
  const hired = by("hired");
  return (
    <>
      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="New" value={by("new")} tone={by("new") ? "warning" : "neutral"} />
        <StatCard label="In process" value={by("screening") + by("interview") + by("assessment") + by("offer")} />
        <StatCard label="Onboarding" value={by("onboarding")} />
        <StatCard label="Conversion to hire" value={total ? `${Math.round(((hired + by("onboarding")) / total) * 100)}%` : "—"} hint={`${total} applications total`} />
      </section>
      <ListFilters q={q} placeholder="Search applicants" hidden={{ tab: "applications" }} selects={[{ name: "status", label: "Status", value: status, options: STATUSES.map((s) => [s, humanize(s)]) }]} />
      <Card className="overflow-hidden">
        {!apps?.length ? <EmptyState icon={Inbox} title="No applications" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Applicant</TH><TH>Opening</TH><TH>Source</TH><TH>Received</TH><TH>Status</TH></tr></THead>
            <TBody>
              {apps.map((a) => (
                <TR key={a.id}>
                  <TD><Link className="font-medium text-primary hover:underline" href={`/admin/recruitment/applications/${a.id}`}>{a.first_name} {a.last_name}</Link><p className="text-xs text-muted-foreground">{a.email}{a.city ? ` · ${a.city}` : ""}</p></TD>
                  <TD className="text-muted-foreground">{a.job_openings?.title ?? "Open application"}</TD>
                  <TD className="text-muted-foreground">{a.source ?? "—"}</TD>
                  <TD className="text-muted-foreground">{formatDateTime(a.created_at)}</TD>
                  <TD><StatusBadge status={a.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function Openings({ agencyId, canWrite }: { agencyId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const [{ data: openings }, { data: positions }, { data: industries }] = await Promise.all([
    supabase.from("job_openings").select("id, title, status, location_city, published_at, closes_at, engagement_types, applications(count)").eq("agency_id", agencyId).order("created_at", { ascending: false }),
    supabase.from("job_positions").select("id, name").eq("agency_id", agencyId).eq("status", "active").order("name"),
    supabase.from("industries").select("id, name").eq("agency_id", agencyId).eq("status", "active").order("sort_order"),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Job openings</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          {!openings?.length ? <EmptyState icon={Megaphone} title="No openings yet" className="mx-5 mb-5" /> : (
            <Table>
              <THead><tr><TH>Opening</TH><TH>Applications</TH><TH>Status</TH>{canWrite && <TH className="text-right">Actions</TH>}</tr></THead>
              <TBody>
                {openings.map((o) => (
                  <TR key={o.id}>
                    <TD><p className="font-medium">{o.title}</p><p className="text-xs text-muted-foreground">{[o.location_city, o.engagement_types.map(humanize).join(" / "), o.closes_at ? `closes ${formatDateTime(o.closes_at)}` : null].filter(Boolean).join(" · ")}</p></TD>
                    <TD className="tabular-nums">{o.applications?.[0]?.count ?? 0}</TD>
                    <TD><StatusBadge status={o.status} /></TD>
                    {canWrite && (
                      <TD className="space-x-1 text-right">
                        {o.status !== "published" && <ConfirmAction action={setOpeningStatusAction} fields={{ id: o.id, status: "published" }} title="Publish on the careers site?" variant="soft">Publish</ConfirmAction>}
                        {o.status === "published" && <ConfirmAction action={setOpeningStatusAction} fields={{ id: o.id, status: "closed" }} title="Close this opening?" variant="ghost" destructive confirmLabel="Close">Close</ConfirmAction>}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>New opening</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={createOpeningAction} submitLabel="Save draft" resetOnSuccess>
              <Field name="title" label="Title" required><Input name="title" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field name="position_id" label="Position"><NativeSelect name="position_id" defaultValue=""><option value="">—</option>{(positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
                <Field name="industry_id" label="Industry"><NativeSelect name="industry_id" defaultValue=""><option value="">—</option>{(industries ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Open to</legend>
                <label className="mr-4 text-sm"><input type="checkbox" name="engagement_types" value="employee" defaultChecked className="mr-1 accent-primary" />Employees</label>
                <label className="text-sm"><input type="checkbox" name="engagement_types" value="freelancer" className="mr-1 accent-primary" />Freelancers</label>
              </fieldset>
              <Field name="location_city" label="City"><Input name="location_city" /></Field>
              <Field name="description" label="Description" required><Textarea name="description" rows={5} /></Field>
              <Field name="requirements_text" label="Requirements"><Textarea name="requirements_text" rows={3} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field name="hours_indication" label="Hours"><Input name="hours_indication" placeholder="16–32 h/week" /></Field>
                <Field name="pay_indication" label="Pay indication"><Input name="pay_indication" placeholder="According to CAO" /></Field>
              </div>
              <Field name="closes_at" label="Closes on"><Input name="closes_at" type="datetime-local" /></Field>
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
