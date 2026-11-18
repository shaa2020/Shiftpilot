import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListChecks } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/components/ui/status-badge";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { addRequirementAction, removeRequirementAction, updatePositionAction } from "../../actions";

export const metadata: Metadata = { title: "Position" };

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: p } = await supabase.from("job_positions").select("*, industries(name)").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [reqs, skills, certs, quals, industries] = await Promise.all([
    supabase.from("position_requirements").select("*, skills(name), certificates(name), qualifications(name)").eq("position_id", id).order("created_at"),
    supabase.from("skills").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    supabase.from("certificates").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    supabase.from("qualifications").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    supabase.from("industries").select("id, name, job_categories(id, name, status)").eq("agency_id", ctx.agencyId).eq("status", "active").order("sort_order"),
  ]);
  const canWrite = ctx.can("industries.manage");

  const describe = (r: NonNullable<typeof reqs.data>[number]) => {
    switch (r.requirement_type) {
      case "skill": return `Skill: ${r.skills?.name}`;
      case "certificate": return `Certificate: ${r.certificates?.name} (valid and verified)`;
      case "qualification": return `Qualification: ${r.qualifications?.name}`;
      case "language": return `Language: ${r.language_code?.toUpperCase()}${r.min_language_level ? ` at least ${r.min_language_level}` : ""}`;
      case "experience": return `Experience: at least ${r.min_experience_months} months`;
      case "engagement": return `Only ${r.engagement_type === "employee" ? "agency employees" : "freelancers"}`;
      default: return `Safety: ${r.description}`;
    }
  };

  const positionFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="industry_id" label="Industry"><NativeSelect name="industry_id" defaultValue={p.industry_id}>{(industries.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect></Field>
      <Field name="category_id" label="Category"><NativeSelect name="category_id" defaultValue={p.category_id ?? ""}><option value="">None</option>{(industries.data ?? []).flatMap((i) => i.job_categories.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{`${i.name} › ${c.name}`}</option>))}</NativeSelect></Field>
      <Field name="name" label="Name" required><Input name="name" defaultValue={p.name} /></Field>
      <Field name="default_dress_code" label="Default dress code"><Input name="default_dress_code" defaultValue={p.default_dress_code ?? ""} /></Field>
      <Field name="description" label="Description" className="sm:col-span-2"><Textarea name="description" rows={3} defaultValue={p.description ?? ""} /></Field>
      <Field name="safety_requirements" label="Safety requirements" className="sm:col-span-2"><Textarea name="safety_requirements" rows={2} defaultValue={p.safety_requirements ?? ""} /></Field>
      <CheckboxField name="allows_freelancers" label="May be offered to freelancers" defaultChecked={p.allows_freelancers} />
      <CheckboxField name="is_regulated" label="Regulated position" defaultChecked={p.is_regulated} />
    </div>
  );

  return (
    <>
      <Link href="/admin/configuration" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Configuration</Link>
      <PageHeader title={p.name} description={p.industries?.name} actions={<div className="space-x-1">{p.is_regulated && <Badge tone="warning">Regulated</Badge>}{p.allows_freelancers && <Badge>Freelancers allowed</Badge>}</div>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Requirements</CardTitle><CardDescription>Mandatory requirements can never be overridden during matching. Preferred requirements improve the match score.</CardDescription></CardHeader>
            <CardContent>
              {!reqs.data?.length ? <EmptyState icon={ListChecks} title="No requirements" description="Without requirements, any active worker is eligible." /> : (
                <ul className="divide-y divide-border text-sm">
                  {reqs.data.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <span>{describe(r)} <Badge tone={r.is_mandatory ? "danger" : "neutral"}>{r.is_mandatory ? "Mandatory" : "Preferred"}</Badge></span>
                      {canWrite && <ConfirmAction action={removeRequirementAction} fields={{ id: r.id }} title="Remove requirement?" variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Position details</CardTitle></CardHeader>
            <CardContent>{canWrite ? <ServerForm action={updatePositionAction.bind(null, id)}>{positionFields}</ServerForm> : <fieldset disabled>{positionFields}</fieldset>}</CardContent>
          </Card>
        </div>
        {canWrite && (
          <Card className="h-fit">
            <CardHeader><CardTitle>Add requirement</CardTitle><CardDescription>Fill in the field that matches the type.</CardDescription></CardHeader>
            <CardContent>
              <ServerForm action={addRequirementAction.bind(null, id)} submitLabel="Add requirement" resetOnSuccess>
                <Field name="requirement_type" label="Type"><NativeSelect name="requirement_type" defaultValue="certificate">{["certificate", "skill", "qualification", "language", "experience", "engagement", "safety"].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</NativeSelect></Field>
                <Field name="certificate_id" label="Certificate"><NativeSelect name="certificate_id" defaultValue=""><option value="">—</option>{(certs.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                <Field name="skill_id" label="Skill"><NativeSelect name="skill_id" defaultValue=""><option value="">—</option>{(skills.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                <Field name="qualification_id" label="Qualification"><NativeSelect name="qualification_id" defaultValue=""><option value="">—</option>{(quals.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field name="language_code" label="Language"><Input name="language_code" maxLength={2} placeholder="nl" /></Field>
                  <Field name="min_language_level" label="Min. level"><NativeSelect name="min_language_level" defaultValue=""><option value="">—</option>{["A1", "A2", "B1", "B2", "C1", "C2", "native"].map((l) => <option key={l}>{l}</option>)}</NativeSelect></Field>
                </div>
                <Field name="min_experience_months" label="Min. experience (months)"><Input name="min_experience_months" type="number" min={0} /></Field>
                <Field name="engagement_type" label="Pathway"><NativeSelect name="engagement_type" defaultValue=""><option value="">—</option><option value="employee">Employees only</option><option value="freelancer">Freelancers only</option></NativeSelect></Field>
                <Field name="description" label="Safety requirement / note"><Input name="description" /></Field>
                <CheckboxField name="is_mandatory" label="Mandatory" defaultChecked />
              </ServerForm>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
