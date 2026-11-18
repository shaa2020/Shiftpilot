import type { Metadata } from "next";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { SectionTabs } from "@/components/ui/detail";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { addOwnAvailabilityAction, addOwnLanguageAction, addOwnSkillAction, removeOwnItemAction, submitTaskAction, updateOwnDetailsAction } from "../actions";

export const metadata: Metadata = { title: "My profile" };
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TABS = ["onboarding", "details", "skills", "availability", "feedback"] as const;

export default async function WorkerProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireWorker();
  const { tab: raw } = await searchParams;
  const tab = (TABS as readonly string[]).includes(raw ?? "") ? raw! : "onboarding";
  const supabase = await createClient();
  const [{ data: w }, { data: pd }] = await Promise.all([
    supabase.from("workers").select("*").eq("id", ctx.workerId).single(),
    supabase.from("worker_private_details").select("*").eq("worker_id", ctx.workerId).single(),
  ]);
  if (!w) return null;

  return (
    <>
      <PageHeader title="My profile" description={`${w.worker_number} · ${w.engagement_type === "employee" ? "Agency employee" : "Freelancer"}`} />
      <SectionTabs tabs={TABS.map((t) => ({ key: t, label: humanize(t), href: `?tab=${t}` }))} active={tab} />
      {tab === "onboarding" && <Onboarding workerId={ctx.workerId} />}
      {tab === "details" && (
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>Identity and work eligibility are checked by the agency in person; their status: identity <StatusBadge status={pd?.identity_verification_status ?? "not_submitted"} />, work eligibility <StatusBadge status={pd?.work_eligibility_status ?? "not_submitted"} />.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerForm action={updateOwnDetailsAction} submitLabel="Save details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="phone" label="Phone"><Input name="phone" type="tel" defaultValue={w.phone ?? ""} autoComplete="tel" /></Field>
                <Field name="date_of_birth" label="Date of birth"><Input name="date_of_birth" type="date" defaultValue={pd?.date_of_birth ?? ""} /></Field>
                <Field name="address_line1" label="Address" className="sm:col-span-2"><Input name="address_line1" defaultValue={pd?.address_line1 ?? ""} autoComplete="street-address" /></Field>
                <Field name="postal_code" label="Postal code"><Input name="postal_code" defaultValue={w.postal_code ?? ""} autoComplete="postal-code" /></Field>
                <Field name="city" label="City"><Input name="city" defaultValue={w.city ?? ""} autoComplete="address-level2" /></Field>
                <Field name="max_travel_km" label="Maximum travel distance (km)"><Input name="max_travel_km" type="number" min={0} max={500} defaultValue={w.max_travel_km ?? ""} /></Field>
                <div />
                <Field name="emergency_contact_name" label="Emergency contact"><Input name="emergency_contact_name" defaultValue={pd?.emergency_contact_name ?? ""} /></Field>
                <Field name="emergency_contact_phone" label="Emergency phone"><Input name="emergency_contact_phone" type="tel" defaultValue={pd?.emergency_contact_phone ?? ""} /></Field>
                <Field name="emergency_contact_relationship" label="Relationship"><Input name="emergency_contact_relationship" defaultValue={pd?.emergency_contact_relationship ?? ""} /></Field>
                <Field name="professional_summary" label="About me (shown to clients for your shifts)" className="sm:col-span-2"><Textarea name="professional_summary" rows={3} defaultValue={w.professional_summary ?? ""} /></Field>
              </div>
            </ServerForm>
          </CardContent>
        </Card>
      )}
      {tab === "skills" && <Skills workerId={ctx.workerId} agencyId={ctx.agencyId} />}
      {tab === "availability" && <Availability workerId={ctx.workerId} />}
      {tab === "feedback" && <Feedback workerId={ctx.workerId} />}
    </>
  );
}

async function Onboarding({ workerId }: { workerId: string }) {
  const supabase = await createClient();
  const { data: tasks } = await supabase.from("onboarding_tasks").select("*").eq("worker_id", workerId).order("sort_order");
  const done = (tasks ?? []).filter((t) => ["completed", "waived"].includes(t.status)).length;
  return (
    <Card>
      <CardHeader><CardTitle>Onboarding checklist</CardTitle><CardDescription>{done} of {tasks?.length ?? 0} done. Tasks marked “Agency” are completed by the agency.</CardDescription></CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {(tasks ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3">
              <span>{t.title}{t.staff_only && <Badge className="ml-2">Agency</Badge>}</span>
              <span className="flex items-center gap-2">
                <StatusBadge status={t.status} />
                {!t.staff_only && t.status === "pending" && <ConfirmAction action={submitTaskAction} fields={{ id: t.id }} title="Mark this task as done?" variant="soft">Done</ConfirmAction>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

async function Skills({ workerId, agencyId }: { workerId: string; agencyId: string }) {
  const supabase = await createClient();
  const [skills, langs, certs, catalog] = await Promise.all([
    supabase.from("worker_skills").select("id, level, is_verified, skills(name)").eq("worker_id", workerId),
    supabase.from("worker_languages").select("id, language_code, level").eq("worker_id", workerId),
    supabase.from("worker_certificates").select("id, status, expires_on, certificates(name)").eq("worker_id", workerId),
    supabase.from("skills").select("id, name").eq("agency_id", agencyId).eq("status", "active").order("name"),
  ]);
  const remove = (table: string, id: string) => <ConfirmAction action={removeOwnItemAction} fields={{ table, id }} title="Remove?" variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Skills</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y divide-border text-sm">{(skills.data ?? []).map((s) => <li key={s.id} className="flex items-center justify-between py-2"><span>{s.skills?.name} · level {s.level} {s.is_verified && <Badge tone="success">Verified</Badge>}</span>{remove("worker_skills", s.id)}</li>)}</ul>
          {!!catalog.data?.length && (
            <ServerForm action={addOwnSkillAction} submitLabel="Add skill" resetOnSuccess className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2" footerClassName="sm:col-span-2">
              <Field name="skill_id" label="Skill"><NativeSelect name="skill_id">{catalog.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
              <Field name="level" label="Level (1–5)"><Input name="level" type="number" min={1} max={5} defaultValue={3} /></Field>
            </ServerForm>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Languages</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y divide-border text-sm">{(langs.data ?? []).map((l) => <li key={l.id} className="flex items-center justify-between py-2"><span className="uppercase">{l.language_code} <span className="normal-case text-muted-foreground">· {l.level}</span></span>{remove("worker_languages", l.id)}</li>)}</ul>
          <ServerForm action={addOwnLanguageAction} submitLabel="Add language" resetOnSuccess className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2" footerClassName="sm:col-span-2">
            <Field name="language_code" label="Language code" hint="e.g. nl, en"><Input name="language_code" maxLength={2} /></Field>
            <Field name="level" label="Level"><NativeSelect name="level" defaultValue="B1">{["A1", "A2", "B1", "B2", "C1", "C2", "native"].map((l) => <option key={l}>{l}</option>)}</NativeSelect></Field>
          </ServerForm>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Certificates</CardTitle><CardDescription>Upload certificates under Documents; the agency verifies them.</CardDescription></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border text-sm">{(certs.data ?? []).map((c) => <li key={c.id} className="flex items-center justify-between py-2"><span>{c.certificates?.name}{c.expires_on && <span className="text-muted-foreground"> · valid until {c.expires_on}</span>}</span><StatusBadge status={c.status} /></li>)}</ul>
          {!certs.data?.length && <p className="text-sm text-muted-foreground">No certificates recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

async function Availability({ workerId }: { workerId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("worker_availability").select("*").eq("worker_id", workerId).order("kind").order("day_of_week").order("date_from");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>My availability</CardTitle><CardDescription>Shifts that match your availability are offered to you first.</CardDescription></CardHeader>
        <CardContent>
          {!data?.length ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
            <ul className="divide-y divide-border text-sm">
              {data.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span><Badge tone={r.kind === "unavailable" ? "danger" : "success"}>{humanize(r.kind)}</Badge> {r.kind === "recurring" ? `${DAYS[r.day_of_week ?? 0]} ${r.start_time?.slice(0, 5)}–${r.end_time?.slice(0, 5)}` : `${r.date_from} → ${r.date_to}`}{r.note ? ` · ${r.note}` : ""}</span>
                  <ConfirmAction action={removeOwnItemAction} fields={{ table: "worker_availability", id: r.id }} title="Remove?" variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader><CardTitle>Add</CardTitle></CardHeader>
        <CardContent>
          <ServerForm action={addOwnAvailabilityAction} submitLabel="Add" resetOnSuccess>
            <Field name="kind" label="Type"><NativeSelect name="kind" defaultValue="recurring"><option value="recurring">Every week</option><option value="available">Available period</option><option value="unavailable">Not available (holiday, exams…)</option></NativeSelect></Field>
            <Field name="day_of_week" label="Day (every week)"><NativeSelect name="day_of_week" defaultValue=""><option value="">—</option>{DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</NativeSelect></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field name="start_time" label="From"><Input name="start_time" type="time" /></Field>
              <Field name="end_time" label="To"><Input name="end_time" type="time" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field name="date_from" label="Start date"><Input name="date_from" type="date" /></Field>
              <Field name="date_to" label="End date"><Input name="date_to" type="date" /></Field>
            </div>
            <Field name="note" label="Note"><Input name="note" /></Field>
          </ServerForm>
        </CardContent>
      </Card>
    </div>
  );
}

/** Ratings clients gave this worker (their own data; clients' internal preferences are not shown). */
async function Feedback({ workerId }: { workerId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("worker_ratings").select("id, rating, comment, created_at").eq("worker_id", workerId).order("created_at", { ascending: false }).limit(50);
  const avg = data?.length ? data.reduce((n, r) => n + r.rating, 0) / data.length : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Client feedback</CardTitle>
        <CardDescription>{avg != null ? `Average ${avg.toFixed(1)} out of 5 from ${data!.length} shift(s). Good ratings help you get more offers.` : "Clients can rate your shifts after they finish. Ratings will appear here."}</CardDescription>
      </CardHeader>
      {!!data?.length && (
        <CardContent>
          <ul className="divide-y divide-border">
            {data.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p className="flex items-center gap-2"><span aria-label={`${r.rating} out of 5`} className="text-amber-500">{"★".repeat(r.rating)}<span className="text-border">{"★".repeat(5 - r.rating)}</span></span><span className="ml-auto text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span></p>
                {r.comment && <p className="text-muted-foreground">“{r.comment}”</p>}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
