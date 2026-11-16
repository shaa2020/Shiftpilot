import type { Metadata } from "next";
import Link from "next/link";
import { Award, Briefcase, Factory, GraduationCap, Wrench } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { SectionTabs } from "@/components/ui/detail";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { addCatalogItemAction, addCategoryAction, addIndustryAction, addPositionAction, setConfigStatusAction } from "./actions";

export const metadata: Metadata = { title: "Configuration" };
const TABS = ["positions", "industries", "skills", "certificates", "qualifications"] as const;
type Tab = (typeof TABS)[number];

function StatusToggle({ table, id, status, canWrite }: { table: string; id: string; status: string; canWrite: boolean }) {
  if (!canWrite) return <StatusBadge status={status} />;
  const archive = status !== "archived";
  return (
    <ConfirmAction action={setConfigStatusAction} fields={{ table, id, status: archive ? "archived" : "active" }} title={archive ? "Archive?" : "Restore?"} description={archive ? "Archived items are hidden from new records; history is kept." : undefined} variant="ghost" destructive={archive}>
      {archive ? "Archive" : "Restore"}
    </ConfirmAction>
  );
}

export default async function ConfigurationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff();
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "positions";
  const canWrite = ctx.can("industries.manage");
  const supabase = await createClient();
  const { data: industries } = await supabase.from("industries").select("id, name, slug, status, description, job_categories(id, name, status)").eq("agency_id", ctx.agencyId).order("sort_order").order("name");
  const activeIndustries = (industries ?? []).filter((i) => i.status === "active");

  return (
    <>
      <PageHeader title="Configuration" description="Industries, job positions, requirements, skills and credentials. Everything here is data — nothing is hard-coded." />
      <SectionTabs tabs={TABS.map((t) => ({ key: t, label: humanize(t), href: `/admin/configuration?tab=${t}` }))} active={tab} />

      {tab === "industries" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Industries & categories</CardTitle></CardHeader>
            <CardContent className="px-0 pb-0">
              {!industries?.length ? <EmptyState icon={Factory} title="No industries" className="mx-5 mb-5" /> : (
                <Table>
                  <THead><tr><TH>Industry</TH><TH>Categories</TH><TH className="text-right">Status</TH></tr></THead>
                  <TBody>
                    {industries.map((i) => (
                      <TR key={i.id}>
                        <TD className="font-medium">{i.name}</TD>
                        <TD><div className="flex flex-wrap gap-1">{i.job_categories.filter((c) => c.status === "active").map((c) => <Badge key={c.id}>{c.name}</Badge>)}</div></TD>
                        <TD className="text-right"><StatusToggle table="industries" id={i.id} status={i.status} canWrite={canWrite} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {canWrite && (
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Add industry</CardTitle></CardHeader>
                <CardContent>
                  <ServerForm action={addIndustryAction} submitLabel="Add industry" resetOnSuccess>
                    <Field name="name" label="Name" required><Input name="name" /></Field>
                    <Field name="description" label="Description"><Textarea name="description" rows={2} /></Field>
                  </ServerForm>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Add job category</CardTitle></CardHeader>
                <CardContent>
                  <ServerForm action={addCategoryAction} submitLabel="Add category" resetOnSuccess>
                    <Field name="industry_id" label="Industry"><NativeSelect name="industry_id">{activeIndustries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect></Field>
                    <Field name="name" label="Category name" required><Input name="name" placeholder="Front of house" /></Field>
                  </ServerForm>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {tab === "positions" && <Positions agencyId={ctx.agencyId} industries={activeIndustries} canWrite={canWrite} />}
      {tab === "skills" && <Catalog agencyId={ctx.agencyId} table="skills" canWrite={canWrite} />}
      {tab === "certificates" && <Catalog agencyId={ctx.agencyId} table="certificates" canWrite={canWrite} />}
      {tab === "qualifications" && <Catalog agencyId={ctx.agencyId} table="qualifications" canWrite={canWrite} />}
    </>
  );
}

async function Positions({ agencyId, industries, canWrite }: { agencyId: string; industries: { id: string; name: string; job_categories: { id: string; name: string; status: string }[] }[]; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: positions } = await supabase.from("job_positions").select("id, name, status, is_regulated, allows_freelancers, industries(name), job_categories(name), position_requirements(count)").eq("agency_id", agencyId).order("name");
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Job positions</CardTitle><CardDescription>Requirements on each position drive worker matching.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">
          {!positions?.length ? <EmptyState icon={Briefcase} title="No positions yet" description="Add the roles your agency supplies, e.g. Cleaner, Forklift driver, Host." className="mx-5 mb-5" /> : (
            <Table>
              <THead><tr><TH>Position</TH><TH>Industry</TH><TH>Requirements</TH><TH>Flags</TH><TH className="text-right">Status</TH></tr></THead>
              <TBody>
                {positions.map((p) => (
                  <TR key={p.id}>
                    <TD><Link href={`/admin/configuration/positions/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link>{p.job_categories?.name && <p className="text-xs text-muted-foreground">{p.job_categories.name}</p>}</TD>
                    <TD className="text-muted-foreground">{p.industries?.name}</TD>
                    <TD className="tabular-nums">{p.position_requirements?.[0]?.count ?? 0}</TD>
                    <TD className="space-x-1">{p.is_regulated && <Badge tone="warning">Regulated</Badge>}{p.allows_freelancers && <Badge>Freelancers allowed</Badge>}</TD>
                    <TD className="text-right"><StatusToggle table="job_positions" id={p.id} status={p.status} canWrite={canWrite} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>Add position</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={addPositionAction} submitLabel="Add position" resetOnSuccess>
              <Field name="industry_id" label="Industry" required><NativeSelect name="industry_id">{industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect></Field>
              <Field name="category_id" label="Category"><NativeSelect name="category_id" defaultValue=""><option value="">None</option>{industries.flatMap((i) => i.job_categories.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{i.name} › {c.name}</option>))}</NativeSelect></Field>
              <Field name="name" label="Position name" required><Input name="name" /></Field>
              <Field name="description" label="Description"><Textarea name="description" rows={2} /></Field>
              <Field name="default_dress_code" label="Default dress code"><Input name="default_dress_code" /></Field>
              <CheckboxField name="allows_freelancers" label="May be offered to freelancers" description="Only after an approved classification review." />
              <CheckboxField name="is_regulated" label="Regulated position" description="Always requires manual compliance review before assignment." />
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Catalog({ agencyId, table, canWrite }: { agencyId: string; table: "skills" | "certificates" | "qualifications"; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: rows } = await supabase.from(table).select("*").eq("agency_id", agencyId).order("name");
  const Icon = table === "skills" ? Wrench : table === "certificates" ? Award : GraduationCap;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>{humanize(table)}</CardTitle></CardHeader>
        <CardContent className="px-0 pb-0">
          {!rows?.length ? <EmptyState icon={Icon} title={`No ${table} yet`} className="mx-5 mb-5" /> : (
            <Table>
              <THead><tr><TH>Name</TH><TH>Details</TH><TH className="text-right">Status</TH></tr></THead>
              <TBody>
                {rows.map((r) => {
                  const row = r as { id: string; name: string; status: string; category?: string | null; issuing_body?: string | null; validity_months?: number | null; is_regulated?: boolean; description?: string | null };
                  return (
                    <TR key={row.id}>
                      <TD className="font-medium">{row.name}</TD>
                      <TD className="text-muted-foreground">
                        {[row.category, row.issuing_body, row.validity_months ? `valid ${row.validity_months} months` : null, row.description].filter(Boolean).join(" · ") || "—"}
                        {row.is_regulated && <Badge tone="warning" className="ml-2">Regulated</Badge>}
                      </TD>
                      <TD className="text-right"><StatusToggle table={table} id={row.id} status={row.status} canWrite={canWrite} /></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>Add {table === "skills" ? "skill" : table === "certificates" ? "certificate" : "qualification"}</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={addCatalogItemAction} submitLabel="Add" resetOnSuccess>
              <input type="hidden" name="table" value={table} />
              <Field name="name" label="Name" required><Input name="name" /></Field>
              {table === "skills" && <Field name="category" label="Category"><Input name="category" placeholder="Technical, hospitality…" /></Field>}
              {table === "certificates" && (
                <>
                  <Field name="issuing_body" label="Issuing body"><Input name="issuing_body" /></Field>
                  <Field name="validity_months" label="Validity (months)"><Input name="validity_months" type="number" min={1} max={240} /></Field>
                </>
              )}
              {table === "qualifications" && <Field name="description" label="Description"><Textarea name="description" rows={2} /></Field>}
              {table !== "skills" && <CheckboxField name="is_regulated" label="Regulated" description="Requires manual compliance verification." />}
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
