import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, CalendarClock, ClipboardList, FileSignature, Languages, Mail, MessageSquare, Phone, StickyNote, Wrench } from "lucide-react";
import { requireStaff, type StaffContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney, localDate } from "@/lib/time";
import { EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SectionTabs } from "@/components/ui/detail";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { InvitationForm } from "@/components/forms/invitation-result";
import { WorkerFields } from "../worker-fields";
import {
  addAvailabilityAction, addCertificateAction, addEmploymentContractAction, addFreelancerAgreementAction, addFreelancerRateAction,
  addLanguageAction, addSkillAction, addWageRateAction, addWorkerNoteAction, inviteWorkerAction, removeWorkerItemAction,
  reviewClassificationAction, saveBusinessAction, setEmploymentContractStatusAction, setFreelancerAgreementStatusAction,
  setOnboardingTaskAction, setWorkerStatusAction, updatePrivateDetailsAction, updateWorkerProfileAction, verifyCertificateAction,
} from "../actions";
import { cancelRequestAction, remindRequestAction, requestDocumentsAction, staffUploadDocumentAction } from "../../documents/actions";
import { documentState, dueLabel, REQUEST_STATUS } from "@/lib/documents/format";
import { RequestDocumentForm } from "@/components/documents/request-form";
import { clearPreferenceAction } from "../feedback-actions";

export const metadata: Metadata = { title: "Worker" };

const TABS = ["overview", "profile", "compliance", "documents", "skills", "availability", "onboarding", "pathway", "feedback", "notes"] as const;
const TAB_LABEL: Record<string, string> = { overview: "Overview", profile: "Details", pathway: "Contract & pay" };
type Tab = (typeof TABS)[number];
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const VERIFY: [string, string][] = [["not_submitted", "Not submitted"], ["pending", "Pending"], ["verified", "Verified"], ["rejected", "Rejected"], ["expired", "Expired"]];

export default async function WorkerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff("workers.read");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "overview";
  const supabase = await createClient();
  const { data: worker } = await supabase.from("workers").select("*").eq("id", id).maybeSingle();
  if (!worker) notFound();
  const { data: blockers } = await supabase.rpc("worker_activation_blockers", { p_worker_id: id });

  const tabs = TABS.filter((t) => t !== "notes" || ctx.can("workers.notes.read")).map((t) => ({ key: t, label: TAB_LABEL[t] ?? humanize(t), href: `/admin/workers/${id}?tab=${t}` }));
  const canWrite = ctx.can("workers.write");
  const transitions: [string, string][] =
    worker.status === "active" ? [["suspended", "Suspend"], ["inactive", "Deactivate"]]
    : worker.status === "archived" ? [["inactive", "Restore"]]
    : [["active", "Activate"], ["inactive", "Deactivate"]];

  return (
    <>
      <Link href="/admin/workers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Workers
      </Link>
      <WorkerHero worker={worker} stats={await workerStats(id)} actions={
          <div className="flex flex-wrap items-center gap-2">
                        {worker.user_id && ctx.can("shifts.read") && (
              <Button asChild variant="secondary" size="sm"><Link href={`/admin/messages?to=worker:${id}`}><MessageSquare /> Message</Link></Button>
            )}
            {canWrite && transitions.map(([s, label]) => (
              <ConfirmAction
                key={s}
                action={setWorkerStatusAction}
                fields={{ id, status: s }}
                title={`${label} worker?`}
                description={s === "active" ? "The database verifies identity, work eligibility and the contract or freelancer review before activating." : "The worker will no longer receive new shift offers."}
                confirmLabel={label}
                destructive={s !== "active"}
              >
                {label}
              </ConfirmAction>
            ))}
            {canWrite && worker.status !== "archived" && (
              <ConfirmAction action={setWorkerStatusAction} fields={{ id, status: "archived" }} title="Archive worker?" description="History is kept; the worker loses portal access." variant="ghost" destructive confirmLabel="Archive">Archive</ConfirmAction>
            )}
          </div>
        } />

      {worker.status !== "active" && worker.status !== "archived" && blockers && blockers.length > 0 && (
        <Alert tone="warning" title="Before this worker can be activated" className="mb-4">
          <ul className="list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </Alert>
      )}
      {canWrite && !worker.user_id && worker.status !== "archived" && (
        <Card className="mb-4">
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-medium">No portal account yet</p>
              <p className="text-sm text-muted-foreground">Invite {worker.first_name} to create an account and complete onboarding in the worker portal.</p>
            </div>
            <div className="sm:w-80"><InvitationForm action={inviteWorkerAction.bind(null, id)} submitLabel="Invite to worker portal">{null}</InvitationForm></div>
          </CardContent>
        </Card>
      )}

      <SectionTabs tabs={tabs} active={tab} />
      {tab === "overview" && <Overview workerId={id} worker={worker} />}
      {tab === "profile" && (
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>
            {canWrite ? (
              <ServerForm action={updateWorkerProfileAction.bind(null, id)} submitLabel="Save profile"><WorkerFields worker={worker} /></ServerForm>
            ) : <fieldset disabled><WorkerFields worker={worker} /></fieldset>}
          </CardContent>
        </Card>
      )}
      {tab === "compliance" && <Compliance workerId={id} ctx={ctx} />}
      {tab === "documents" && <WorkerDocuments workerId={id} ctx={ctx} />}
      {tab === "skills" && <Skills workerId={id} ctx={ctx} />}
      {tab === "availability" && <Availability workerId={id} canWrite={canWrite} />}
      {tab === "onboarding" && <Onboarding workerId={id} canWrite={canWrite} />}
      {tab === "pathway" && (worker.engagement_type === "employee" ? <EmployeePathway workerId={id} ctx={ctx} /> : <FreelancerPathway workerId={id} ctx={ctx} />)}
      {tab === "feedback" && <Feedback workerId={id} canClear={ctx.can("clients.write")} />}
      {tab === "notes" && ctx.can("workers.notes.read") && <Notes workerId={id} />}
    </>
  );
}

async function Compliance({ workerId, ctx }: { workerId: string; ctx: StaffContext }) {
  if (!ctx.can("workers.sensitive.read")) {
    return <Alert tone="info">Sensitive personal details and verification statuses require the “View sensitive worker data” permission.</Alert>;
  }
  const supabase = await createClient();
  const { data: d } = await supabase.from("worker_private_details").select("*").eq("worker_id", workerId).single();
  if (!d) return null;
  const editable = ctx.can("workers.write");
  const fields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field name="identity_verification_status" label="Identity verification" hint="Record the outcome only after checking the original document.">
        <NativeSelect name="identity_verification_status" defaultValue={d.identity_verification_status}>{VERIFY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
      </Field>
      <Field name="work_eligibility_status" label="Work eligibility">
        <NativeSelect name="work_eligibility_status" defaultValue={d.work_eligibility_status}>{VERIFY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
      </Field>
      <Field name="work_eligibility_expires_on" label="Work eligibility valid until" hint="Leave empty if unlimited."><Input name="work_eligibility_expires_on" type="date" defaultValue={d.work_eligibility_expires_on ?? ""} /></Field>
      <Field name="date_of_birth" label="Date of birth" hint="Needed for age-dependent wage rules."><Input name="date_of_birth" type="date" defaultValue={d.date_of_birth ?? ""} /></Field>
      <Field name="address_line1" label="Home address" className="sm:col-span-2"><Input name="address_line1" defaultValue={d.address_line1 ?? ""} /></Field>
      <Field name="emergency_contact_name" label="Emergency contact"><Input name="emergency_contact_name" defaultValue={d.emergency_contact_name ?? ""} /></Field>
      <Field name="emergency_contact_phone" label="Emergency phone"><Input name="emergency_contact_phone" type="tel" defaultValue={d.emergency_contact_phone ?? ""} /></Field>
      <Field name="emergency_contact_relationship" label="Relationship"><Input name="emergency_contact_relationship" defaultValue={d.emergency_contact_relationship ?? ""} /></Field>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity, eligibility & personal details</CardTitle>
        <CardDescription>
          Restricted data. ShiftPilot stores verification outcomes, not document numbers or BSN.
          {d.identity_verified_at && ` Identity verified ${formatDateTime(d.identity_verified_at)}.`}
          {d.work_eligibility_verified_at && ` Eligibility verified ${formatDateTime(d.work_eligibility_verified_at)}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {editable ? <ServerForm action={updatePrivateDetailsAction.bind(null, workerId)} submitLabel="Save">{fields}</ServerForm> : <fieldset disabled>{fields}</fieldset>}
      </CardContent>
    </Card>
  );
}

async function Skills({ workerId, ctx }: { workerId: string; ctx: StaffContext }) {
  const supabase = await createClient();
  const [skills, langs, certs, allSkills, allCerts] = await Promise.all([
    supabase.from("worker_skills").select("id, level, years_experience, is_verified, skills(name)").eq("worker_id", workerId),
    supabase.from("worker_languages").select("id, language_code, level").eq("worker_id", workerId),
    supabase.from("worker_certificates").select("id, certificate_number, issued_on, expires_on, status, certificates(name)").eq("worker_id", workerId).order("expires_on"),
    supabase.from("skills").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    supabase.from("certificates").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
  ]);
  const canWrite = ctx.can("workers.write");
  const today = localDate(new Date());
  const remove = (table: string, id: string, label: string) =>
    canWrite && <ConfirmAction action={removeWorkerItemAction} fields={{ table, id }} title={`Remove ${label}?`} variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Skills</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!skills.data?.length ? <EmptyState icon={Wrench} title="No skills recorded" /> : (
            <ul className="divide-y divide-border text-sm">
              {skills.data.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <span>{s.skills?.name} <span className="text-muted-foreground">· level {s.level}{s.years_experience ? ` · ${s.years_experience} yrs` : ""}</span></span>
                  {remove("worker_skills", s.id, "skill")}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            allSkills.data?.length ? (
              <ServerForm action={addSkillAction.bind(null, workerId)} submitLabel="Add skill" resetOnSuccess className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3" footerClassName="sm:col-span-3">
                <Field name="skill_id" label="Skill"><NativeSelect name="skill_id" defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...allSkills.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)]}</NativeSelect></Field>
                <Field name="level" label="Level (1–5)"><Input name="level" type="number" min={1} max={5} defaultValue={3} /></Field>
                <Field name="years_experience" label="Years"><Input name="years_experience" type="number" step="0.5" min={0} /></Field>
              </ServerForm>
            ) : <p className="text-sm text-muted-foreground">Define skills under <Link className="text-primary hover:underline" href="/admin/configuration?tab=skills">Configuration</Link> first.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Languages</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!langs.data?.length ? <EmptyState icon={Languages} title="No languages recorded" /> : (
            <ul className="divide-y divide-border text-sm">
              {langs.data.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2">
                  <span className="uppercase">{l.language_code} <span className="normal-case text-muted-foreground">· {l.level}</span></span>
                  {remove("worker_languages", l.id, "language")}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <ServerForm action={addLanguageAction.bind(null, workerId)} submitLabel="Add language" resetOnSuccess className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2" footerClassName="sm:col-span-2">
              <Field name="language_code" label="Language code" hint="e.g. nl, en, pl"><Input name="language_code" maxLength={2} /></Field>
              <Field name="level" label="Level"><NativeSelect name="level" defaultValue="B1">{["A1", "A2", "B1", "B2", "C1", "C2", "native"].map((l) => <option key={l}>{l}</option>)}</NativeSelect></Field>
            </ServerForm>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Certificates</CardTitle><CardDescription>Certificates must be verified before they count for shift eligibility.</CardDescription></CardHeader>
        <CardContent className="space-y-4 px-0">
          {!certs.data?.length ? <EmptyState icon={Award} title="No certificates recorded" className="mx-5" /> : (
            <Table>
              <THead><tr><TH>Certificate</TH><TH>Valid</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
              <TBody>
                {certs.data.map((c) => {
                  const expired = c.expires_on && c.expires_on < today;
                  return (
                    <TR key={c.id}>
                      <TD><p className="font-medium">{c.certificates?.name}</p>{c.certificate_number && <p className="text-xs text-muted-foreground">No. {c.certificate_number}</p>}</TD>
                      <TD className={expired ? "text-danger" : "text-muted-foreground"}>{c.issued_on ?? "?"} → {c.expires_on ?? "no expiry"}{expired ? " (expired)" : ""}</TD>
                      <TD><StatusBadge status={c.status} /></TD>
                      <TD className="space-x-1 text-right">
                        {ctx.can("documents.verify") && c.status === "pending" && (
                          <>
                            <ConfirmAction action={verifyCertificateAction} fields={{ id: c.id, status: "verified" }} title="Verify certificate?" description="Confirm you have checked the original certificate." confirmLabel="Verify">Verify</ConfirmAction>
                            <ConfirmAction action={verifyCertificateAction} fields={{ id: c.id, status: "rejected" }} title="Reject certificate?" variant="ghost" destructive confirmLabel="Reject">Reject</ConfirmAction>
                          </>
                        )}
                        {remove("worker_certificates", c.id, "certificate")}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
          {canWrite && allCerts.data && allCerts.data.length > 0 && (
            <div className="mx-5 border-t border-border pt-4">
              <ServerForm action={addCertificateAction.bind(null, workerId)} submitLabel="Add certificate" resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-4" footerClassName="sm:col-span-4">
                <Field name="certificate_id" label="Certificate"><NativeSelect name="certificate_id" defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...allCerts.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)]}</NativeSelect></Field>
                <Field name="certificate_number" label="Number"><Input name="certificate_number" /></Field>
                <Field name="issued_on" label="Issued"><Input name="issued_on" type="date" /></Field>
                <Field name="expires_on" label="Expires"><Input name="expires_on" type="date" /></Field>
              </ServerForm>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function Availability({ workerId, canWrite }: { workerId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: rows } = await supabase.from("worker_availability").select("*").eq("worker_id", workerId).order("kind").order("day_of_week").order("date_from");
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Availability</CardTitle><CardDescription>Weekly pattern plus specific available or unavailable periods (holidays, exams).</CardDescription></CardHeader>
        <CardContent>
          {!rows?.length ? <EmptyState icon={CalendarClock} title="No availability recorded" /> : (
            <ul className="divide-y divide-border text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>
                    <Badge tone={r.kind === "unavailable" ? "danger" : r.kind === "available" ? "success" : "info"}>{humanize(r.kind)}</Badge>{" "}
                    {r.kind === "recurring" ? `${DAYS[r.day_of_week ?? 0]} ${r.start_time?.slice(0, 5)}–${r.end_time?.slice(0, 5)}` : `${r.date_from} → ${r.date_to}${r.start_time ? ` ${r.start_time.slice(0, 5)}–${r.end_time?.slice(0, 5)}` : ""}`}
                    {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
                  </span>
                  {canWrite && <ConfirmAction action={removeWorkerItemAction} fields={{ table: "worker_availability", id: r.id }} title="Remove availability?" variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>Add availability</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={addAvailabilityAction.bind(null, workerId)} submitLabel="Add" resetOnSuccess>
              <Field name="kind" label="Type"><NativeSelect name="kind" defaultValue="recurring"><option value="recurring">Weekly pattern</option><option value="available">Available period</option><option value="unavailable">Unavailable period</option></NativeSelect></Field>
              <Field name="day_of_week" label="Day (weekly pattern)"><NativeSelect name="day_of_week" defaultValue=""><option value="">—</option>{DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</NativeSelect></Field>
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
      )}
    </div>
  );
}

async function Onboarding({ workerId, canWrite }: { workerId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: tasks } = await supabase.from("onboarding_tasks").select("*").eq("worker_id", workerId).order("sort_order");
  const done = (tasks ?? []).filter((t) => t.status === "completed" || t.status === "waived").length;
  return (
    <Card>
      <CardHeader><CardTitle>Onboarding</CardTitle><CardDescription>{done} of {tasks?.length ?? 0} tasks complete. Identity, eligibility and contract tasks complete automatically when recorded.</CardDescription></CardHeader>
      <CardContent className="px-0 pb-0">
        {!tasks?.length ? <EmptyState icon={ClipboardList} title="No onboarding tasks" className="mx-5 mb-5" /> : (
          <Table>
            <THead><tr><TH>Task</TH><TH>Owner</TH><TH>Status</TH>{canWrite && <TH className="text-right">Actions</TH>}</tr></THead>
            <TBody>
              {tasks.map((t) => (
                <TR key={t.id}>
                  <TD>{t.title}{t.is_required && <span className="ml-1 text-xs text-muted-foreground">(required)</span>}</TD>
                  <TD className="text-muted-foreground">{t.staff_only ? "Agency" : "Worker"}</TD>
                  <TD><StatusBadge status={t.status} /></TD>
                  {canWrite && (
                    <TD className="space-x-1 text-right">
                      {t.status !== "completed" && <ConfirmAction action={setOnboardingTaskAction} fields={{ id: t.id, status: "completed" }} title="Mark task complete?" confirmLabel="Complete" variant="soft">Complete</ConfirmAction>}
                      {t.status !== "waived" && !t.is_required && <ConfirmAction action={setOnboardingTaskAction} fields={{ id: t.id, status: "waived" }} title="Waive this task?" variant="ghost">Waive</ConfirmAction>}
                      {(t.status === "completed" || t.status === "waived") && <ConfirmAction action={setOnboardingTaskAction} fields={{ id: t.id, status: "pending" }} title="Reopen task?" variant="ghost">Reopen</ConfirmAction>}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function EmployeePathway({ workerId, ctx }: { workerId: string; ctx: StaffContext }) {
  const supabase = await createClient();
  const [contracts, rates, positions] = await Promise.all([
    supabase.from("employment_contracts").select("*").eq("worker_id", workerId).order("start_date", { ascending: false }),
    ctx.can("rates.read") ? supabase.from("wage_rates").select("*, job_positions(name)").eq("worker_id", workerId).order("effective_from", { ascending: false }) : Promise.resolve({ data: null }),
    supabase.from("job_positions").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
  ]);
  const canWrite = ctx.can("workers.write");
  const activeContracts = (contracts.data ?? []).filter((c) => c.status === "active");
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader><CardTitle>Employment contracts</CardTitle><CardDescription>Contracts are signed through your approved e-signature process; record the signature here.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-0">
            {!contracts.data?.length ? <EmptyState icon={FileSignature} title="No contracts yet" className="mx-5 mb-5" /> : (
              <Table>
                <THead><tr><TH>Contract</TH><TH>Period</TH><TH>Status</TH>{canWrite && <TH className="text-right">Actions</TH>}</tr></THead>
                <TBody>
                  {contracts.data.map((c) => (
                    <TR key={c.id}>
                      <TD><p className="font-medium">{c.contract_number}</p><p className="text-xs text-muted-foreground">{c.contract_kind}{c.contracted_hours_per_week ? ` · ${c.contracted_hours_per_week} h/week` : ""}</p></TD>
                      <TD className="text-muted-foreground">{c.start_date} → {c.end_date ?? "open-ended"}</TD>
                      <TD><StatusBadge status={c.status} /></TD>
                      {canWrite && (
                        <TD className="space-x-1 text-right">
                          {c.status === "draft" && <ConfirmAction action={setEmploymentContractStatusAction} fields={{ id: c.id, status: "pending_signature" }} title="Send for signature?" variant="soft">Send</ConfirmAction>}
                          {c.status === "pending_signature" && <ConfirmAction action={setEmploymentContractStatusAction} fields={{ id: c.id, status: "active" }} title="Record signed contract?" description="Confirm both parties signed through the approved process." confirmLabel="Mark signed">Mark signed</ConfirmAction>}
                          {c.status === "active" && <ConfirmAction action={setEmploymentContractStatusAction} fields={{ id: c.id, status: "ended" }} title="End contract?" variant="ghost" destructive confirmLabel="End">End</ConfirmAction>}
                          {(c.status === "draft" || c.status === "pending_signature") && <ConfirmAction action={setEmploymentContractStatusAction} fields={{ id: c.id, status: "cancelled" }} title="Cancel contract?" variant="ghost" destructive confirmLabel="Cancel contract">Cancel</ConfirmAction>}
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {rates.data && (
          <Card>
            <CardHeader><CardTitle>Wage rates</CardTitle><CardDescription>Gross hourly wages. Rates are immutable; a new rate automatically closes the previous one.</CardDescription></CardHeader>
            <CardContent className="px-0 pb-0">
              {!rates.data.length ? <EmptyState title="No wage rates" className="mx-5 mb-5" /> : (
                <Table>
                  <THead><tr><TH>Position</TH><TH>Gross / hour</TH><TH>Effective</TH></tr></THead>
                  <TBody>
                    {rates.data.map((r) => (
                      <TR key={r.id}>
                        <TD>{r.job_positions?.name ?? "All positions"}</TD>
                        <TD className="tabular-nums">{formatMoney(Number(r.hourly_gross))}</TD>
                        <TD className="text-muted-foreground">{r.effective_from} → {r.effective_to ?? "current"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <div className="space-y-6">
        {canWrite && (
          <Card>
            <CardHeader><CardTitle>New contract</CardTitle></CardHeader>
            <CardContent>
              <ServerForm action={addEmploymentContractAction.bind(null, workerId)} submitLabel="Create draft" resetOnSuccess>
                <Field name="contract_number" label="Contract number" required><Input name="contract_number" /></Field>
                <Field name="contract_kind" label="Contract type" required hint="e.g. Phase A (agency clause), fixed term, on-call"><Input name="contract_kind" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field name="start_date" label="Start" required><Input name="start_date" type="date" /></Field>
                  <Field name="end_date" label="End"><Input name="end_date" type="date" /></Field>
                </div>
                <Field name="contracted_hours_per_week" label="Hours per week"><Input name="contracted_hours_per_week" type="number" step="0.5" min={0} max={60} /></Field>
              </ServerForm>
            </CardContent>
          </Card>
        )}
        {ctx.can("rates.write") && activeContracts.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Add wage rate</CardTitle><CardDescription>Check the applicable CAO and minimum wage before entering.</CardDescription></CardHeader>
            <CardContent>
              <ServerForm action={addWageRateAction.bind(null, workerId)} submitLabel="Add rate" resetOnSuccess>
                <Field name="contract_id" label="Contract"><NativeSelect name="contract_id" defaultValue={activeContracts[0].id}>{activeContracts.map((c) => <option key={c.id} value={c.id}>{c.contract_number}</option>)}</NativeSelect></Field>
                <Field name="position_id" label="Position"><NativeSelect name="position_id" defaultValue=""><option value="">All positions</option>{(positions.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
                <Field name="hourly_gross" label="Gross hourly wage (€)" required><Input name="hourly_gross" type="number" step="0.01" min={0} /></Field>
                <Field name="effective_from" label="Effective from" required><Input name="effective_from" type="date" /></Field>
                <Field name="reason" label="Reason"><Input name="reason" placeholder="CAO increase, new position…" /></Field>
              </ServerForm>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

async function FreelancerPathway({ workerId, ctx }: { workerId: string; ctx: StaffContext }) {
  const supabase = await createClient();
  const { data: biz } = await supabase.from("freelancer_businesses").select("*").eq("worker_id", workerId).maybeSingle();
  const [agreements, positions, reviews] = await Promise.all([
    biz ? supabase.from("freelancer_agreements").select("*, freelancer_rate_agreements(*, job_positions(name))").eq("business_id", biz.id).order("start_date", { ascending: false }) : Promise.resolve({ data: null }),
    supabase.from("job_positions").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").eq("allows_freelancers", true).order("name"),
    ctx.can("compliance.read") ? supabase.from("compliance_reviews").select("id, status, rationale, decided_at").eq("worker_id", workerId).eq("review_type", "freelancer_classification").order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
  ]);
  const canWrite = ctx.can("workers.write");
  const activeAgreements = (agreements.data ?? []).filter((a) => a.status === "active");
  const bizFields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field name="trade_name" label="Trade name" required><Input name="trade_name" defaultValue={biz?.trade_name ?? ""} /></Field>
      <Field name="legal_form" label="Legal form"><Input name="legal_form" defaultValue={biz?.legal_form ?? "eenmanszaak"} /></Field>
      <Field name="kvk_number" label="KvK number"><Input name="kvk_number" defaultValue={biz?.kvk_number ?? ""} /></Field>
      <Field name="vat_number" label="VAT number"><Input name="vat_number" defaultValue={biz?.vat_number ?? ""} /></Field>
      <Field name="address_line1" label="Business address" className="sm:col-span-2"><Input name="address_line1" defaultValue={biz?.address_line1 ?? ""} /></Field>
      <Field name="postal_code" label="Postal code"><Input name="postal_code" defaultValue={biz?.postal_code ?? ""} /></Field>
      <Field name="city" label="City"><Input name="city" defaultValue={biz?.city ?? ""} /></Field>
      <Field name="liability_insurance_expires_on" label="Liability insurance valid until"><Input name="liability_insurance_expires_on" type="date" defaultValue={biz?.liability_insurance_expires_on ?? ""} /></Field>
      <div className="space-y-2 pt-6">
        <CheckboxField name="vat_liable" label="VAT liable" defaultChecked={biz?.vat_liable ?? true} />
        <CheckboxField name="small_business_scheme" label="Uses small business scheme (KOR)" defaultChecked={biz?.small_business_scheme ?? false} />
        <CheckboxField name="liability_insurance" label="Has liability insurance" defaultChecked={biz?.liability_insurance ?? false} />
      </div>
    </div>
  );
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Business</CardTitle>
          <CardDescription>A KvK registration alone does not make an assignment genuine self-employment. Classification is decided by a compliance review.</CardDescription>
        </CardHeader>
        <CardContent>
          {canWrite ? <ServerForm action={saveBusinessAction.bind(null, workerId)} submitLabel="Save business details">{bizFields}</ServerForm> : <fieldset disabled>{bizFields}</fieldset>}
        </CardContent>
      </Card>

      {biz && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Classification review <StatusBadge status={biz.classification_status} /></CardTitle>
            <CardDescription>Record the outcome of the employment-relationship assessment. Restricted outcomes limit which assignments may be offered.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reviews.data && reviews.data.length > 0 && (
              <ul className="divide-y divide-border text-sm">
                {reviews.data.map((r) => (
                  <li key={r.id} className="py-2"><StatusBadge status={r.status} /> <span className="text-muted-foreground">{r.decided_at ? formatDateTime(r.decided_at) : ""}</span><p className="mt-1">{r.rationale}</p></li>
                ))}
              </ul>
            )}
            {ctx.can("compliance.review") && (
              <div className="flex flex-wrap gap-2">
                {(["approved", "restricted", "rejected"] as const).map((o) => (
                  <ConfirmAction key={o} action={reviewClassificationAction} fields={{ business_id: biz.id, worker_id: workerId, outcome: o }} title={`Record outcome: ${o}`} description="This decision is recorded permanently with your name and rationale." withReason="Rationale" confirmLabel="Record decision" variant={o === "approved" ? "default" : "secondary"} destructive={o === "rejected"}>
                    {humanize(o)}
                  </ConfirmAction>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {biz && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Agreements & rates</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!agreements.data?.length ? <EmptyState icon={FileSignature} title="No agreements yet" /> : agreements.data.map((a) => (
                <div key={a.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="font-medium">{a.agreement_number} <StatusBadge status={a.status} /></p><p className="text-xs text-muted-foreground">{a.start_date} → {a.end_date ?? "open-ended"}</p></div>
                    {canWrite && (
                      <div className="space-x-1">
                        {a.status === "draft" && <ConfirmAction action={setFreelancerAgreementStatusAction} fields={{ id: a.id, worker_id: workerId, status: "pending_signature" }} title="Send for signature?" variant="soft">Send</ConfirmAction>}
                        {a.status === "pending_signature" && <ConfirmAction action={setFreelancerAgreementStatusAction} fields={{ id: a.id, worker_id: workerId, status: "active" }} title="Record signed agreement?" confirmLabel="Mark signed">Mark signed</ConfirmAction>}
                        {a.status === "active" && <ConfirmAction action={setFreelancerAgreementStatusAction} fields={{ id: a.id, worker_id: workerId, status: "terminated" }} title="Terminate agreement?" variant="ghost" destructive confirmLabel="Terminate">Terminate</ConfirmAction>}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{a.service_description}</p>
                  {ctx.can("rates.read") && a.freelancer_rate_agreements.length > 0 && (
                    <ul className="mt-2 text-sm">
                      {a.freelancer_rate_agreements.map((r) => (
                        <li key={r.id}>{r.job_positions?.name ?? "All positions"}: <span className="tabular-nums">{r.hourly_rate ? formatMoney(Number(r.hourly_rate)) + "/h" : "—"}</span> <span className="text-muted-foreground">({r.effective_from} → {r.effective_to ?? "current"})</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="space-y-6">
            {canWrite && (
              <Card>
                <CardHeader><CardTitle>New agreement</CardTitle></CardHeader>
                <CardContent>
                  <ServerForm action={addFreelancerAgreementAction.bind(null, workerId, biz.id)} submitLabel="Create draft" resetOnSuccess>
                    <Field name="agreement_number" label="Agreement number" required><Input name="agreement_number" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field name="start_date" label="Start" required><Input name="start_date" type="date" /></Field>
                      <Field name="end_date" label="End"><Input name="end_date" type="date" /></Field>
                    </div>
                    <Field name="service_description" label="Services" required><Textarea name="service_description" rows={3} /></Field>
                    <Field name="model_agreement_reference" label="Model agreement reference"><Input name="model_agreement_reference" /></Field>
                  </ServerForm>
                </CardContent>
              </Card>
            )}
            {ctx.can("rates.write") && activeAgreements.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Add commercial rate</CardTitle></CardHeader>
                <CardContent>
                  <ServerForm action={addFreelancerRateAction.bind(null, workerId)} submitLabel="Add rate" resetOnSuccess>
                    <Field name="agreement_id" label="Agreement"><NativeSelect name="agreement_id" defaultValue={activeAgreements[0].id}>{activeAgreements.map((a) => <option key={a.id} value={a.id}>{a.agreement_number}</option>)}</NativeSelect></Field>
                    <Field name="position_id" label="Position"><NativeSelect name="position_id" defaultValue=""><option value="">All positions</option>{(positions.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
                    <Field name="hourly_rate" label="Hourly rate excl. VAT (€)" required><Input name="hourly_rate" type="number" step="0.01" min={0} /></Field>
                    <Field name="effective_from" label="Effective from" required><Input name="effective_from" type="date" /></Field>
                  </ServerForm>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function Notes({ workerId }: { workerId: string }) {
  const supabase = await createClient();
  const { data: notes } = await supabase.from("internal_notes").select("id, body, created_at, profiles!internal_notes_created_by_fkey(full_name, email)").eq("subject_type", "worker").eq("subject_id", workerId).order("created_at", { ascending: false });
  return (
    <Card>
      <CardHeader><CardTitle>Internal notes</CardTitle><CardDescription>Visible to agency staff with note access only — never to clients or the worker.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <ServerForm action={addWorkerNoteAction.bind(null, workerId)} submitLabel="Add note" resetOnSuccess>
          <Field name="body" label="Note"><Textarea name="body" rows={3} /></Field>
        </ServerForm>
        {!notes?.length ? <EmptyState icon={StickyNote} title="No notes yet" /> : (
          <ul className="divide-y divide-border">
            {notes.map((n) => (
              <li key={n.id} className="py-3 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{n.profiles?.full_name ?? n.profiles?.email} · {formatDateTime(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function WorkerDocuments({ workerId, ctx }: { workerId: string; ctx: Awaited<ReturnType<typeof requireStaff>> }) {
  const supabase = await createClient();
  const today = localDate(new Date());
  const [{ data: list }, { data: requests }, { data: types }, { data: extra }] = await Promise.all([
    supabase.rpc("worker_document_checklist", { p_worker_id: workerId }),
    supabase.rpc("worker_document_requests", { p_worker_id: workerId }),
    supabase.from("document_types").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").eq("applies_to", "worker").order("name"),
    supabase.from("documents").select("id, title, status, expires_on, current_version, document_types(key, name)").eq("worker_id", workerId).is("archived_at", null).order("created_at", { ascending: false }),
  ]);
  const canUpload = ctx.can("documents.upload");
  const upload = staffUploadDocumentAction.bind(null, { workerId });
  const openReq = (requests ?? []).filter((r) => r.status === "open" || r.status === "submitted");
  const required = (list ?? []).filter((d) => d.required);
  const done = required.filter((d) => ["verified", "expiring"].includes(documentState(d, today).key)).length;
  // Documents outside the checklist (e.g. "Other document" requests): show them too.
  const checklistIds = new Set((list ?? []).map((d) => d.document_id).filter(Boolean));
  const others = (extra ?? []).filter((d) => !checklistIds.has(d.id) && d.current_version > 0);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <Card>
          <CardContent className="pt-5">
            <div className="mb-2 flex items-baseline justify-between text-sm"><span className="font-medium">Required documents</span><span className="text-muted-foreground">{done} of {required.length} verified</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={done} aria-label="Required documents verified">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${required.length ? (done / required.length) * 100 : 100}%` }} />
            </div>
          </CardContent>
        </Card>

        {openReq.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Open requests</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {openReq.map((r) => {
                  const due = r.status === "open" ? dueLabel(r.due_on, today) : null;
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <Link href={`/admin/documents/${r.document_id}`} className="min-w-0 flex-1 font-medium hover:underline">{r.title}</Link>
                      <Badge tone={REQUEST_STATUS[r.status]?.tone}>{REQUEST_STATUS[r.status]?.label}</Badge>
                      {due && <Badge tone={due.overdue ? "danger" : "neutral"}>{due.label}</Badge>}
                      {canUpload && r.status === "open" && <ConfirmAction action={remindRequestAction} fields={{ id: r.id }} title="Send a reminder?" confirmLabel="Send" variant="ghost">Remind</ConfirmAction>}
                      {canUpload && <ConfirmAction action={cancelRequestAction} fields={{ id: r.id, worker_id: workerId }} title="Cancel this request?" withReason="Reason (optional)" reasonOptional confirmLabel="Cancel request" destructive variant="ghost">Cancel</ConfirmAction>}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Checklist</CardTitle><CardDescription>Every document type for this worker&apos;s pathway. Open a document to preview, verify or see its history.</CardDescription></CardHeader>
          {!list?.length ? <EmptyState icon={Award} title="No document types configured" className="m-5" /> : (
            <ul className="divide-y divide-border">
              {list.map((d) => {
                const st = documentState({ ...d, requested: openReq.some((r) => r.document_id === d.document_id) }, today);
                return (
                  <li key={d.document_type_id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {d.document_id && d.current_version > 0 ? <Link href={`/admin/documents/${d.document_id}`} className="hover:underline">{d.name}</Link> : d.name}
                        {d.required && <Badge tone="warning">Required</Badge>}
                        {d.is_sensitive && <Badge>Sensitive</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">{d.current_version > 0 ? `Version ${d.current_version}` : "No file"}{d.expires_on ? ` · valid until ${formatDate(d.expires_on)}` : ""}</p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {canUpload && (
                      <ServerForm action={upload} submitLabel={d.current_version > 0 ? "New version" : "Upload"} pendingLabel="Uploading…" resetOnSuccess className="flex flex-wrap items-end gap-2 space-y-0" footerClassName="m-0">
                        <input type="hidden" name="document_type_id" value={d.document_type_id} />
                        <input type="hidden" name="document_id" value={d.document_id ?? ""} />
                        <input name="file" type="file" aria-label={`File for ${d.name}`} accept="application/pdf,image/jpeg,image/png,image/webp" className="max-w-48 text-xs" />
                        {!d.document_id && d.requires_expiry && <Input name="expires_on" type="date" aria-label="Expires on" className="h-8 w-36" />}
                      </ServerForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {others.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Other documents</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {others.map((d) => {
                  const st = documentState(d, today);
                  return (
                    <li key={d.id} className="flex items-center gap-2 py-2.5 text-sm">
                      <Link href={`/admin/documents/${d.id}`} className="min-w-0 flex-1 font-medium hover:underline">{d.title}</Link>
                      <span className="text-xs text-muted-foreground">{d.document_types?.name}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
      {canUpload && (
        <Card className="lg:sticky lg:top-24 lg:self-start">
          <CardHeader><CardTitle>Request a document</CardTitle><CardDescription>The worker is notified and sees it at the top of their documents.</CardDescription></CardHeader>
          <CardContent><RequestDocumentForm action={requestDocumentsAction} types={types ?? []} workerId={workerId} minDate={today} /></CardContent>
        </Card>
      )}
    </div>
  );
}

async function Feedback({ workerId, canClear }: { workerId: string; canClear: boolean }) {
  const supabase = await createClient();
  const [{ data: ratings }, { data: prefs }] = await Promise.all([
    supabase.from("worker_ratings").select("id, rating, comment, created_at, clients(name)").eq("worker_id", workerId).order("created_at", { ascending: false }).limit(100),
    supabase.from("client_worker_preferences").select("id, client_id, kind, reason, created_at, clients(name)").eq("worker_id", workerId).order("created_at", { ascending: false }),
  ]);
  const avg = ratings?.length ? ratings.reduce((n, r) => n + r.rating, 0) / ratings.length : null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Client ratings</CardTitle>
          <CardDescription>{avg != null ? `Average ${avg.toFixed(1)} / 5 from ${ratings!.length} rating(s). Ratings add to the matching score.` : "No ratings yet."}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {(ratings ?? []).map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p className="flex items-center gap-2"><span className="font-medium">{r.clients?.name}</span><span aria-label={`${r.rating} out of 5`} className="text-amber-500">{"★".repeat(r.rating)}<span className="text-border">{"★".repeat(5 - r.rating)}</span></span><span className="ml-auto text-xs text-muted-foreground">{formatDate(r.created_at)}</span></p>
                {r.comment && <p className="text-muted-foreground">{r.comment}</p>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Client preferences</CardTitle>
          <CardDescription>Blocked workers are never matched to that client; preferred workers rank higher.</CardDescription>
        </CardHeader>
        <CardContent>
          {!prefs?.length ? <p className="text-sm text-muted-foreground">No client has marked this worker.</p> : (
            <ul className="divide-y divide-border">
              {prefs.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{p.clients?.name}</span>
                  <Badge tone={p.kind === "blocked" ? "danger" : "success"}>{p.kind === "blocked" ? "Blocked" : "Preferred"}</Badge>
                  {p.reason && <span className="w-full text-muted-foreground">{p.reason}</span>}
                  {canClear && (
                    <span className="ml-auto">
                      <ConfirmAction action={clearPreferenceAction} fields={{ client_id: p.client_id, worker_id: workerId }} title="Remove this client preference?" description="Only do this after agreeing it with the client." confirmLabel="Remove" variant="ghost">Remove</ConfirmAction>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function workerStats(workerId: string) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [done, noShow, hours, ratings, docs] = await Promise.all([
    supabase.from("shift_assignments").select("id", { count: "exact", head: true }).eq("worker_id", workerId).in("status", ["completed", "checked_out"]),
    supabase.from("shift_assignments").select("id", { count: "exact", head: true }).eq("worker_id", workerId).eq("status", "no_show"),
    supabase.from("timesheets").select("worked_minutes").eq("worker_id", workerId).neq("status", "draft").gte("scheduled_start", since),
    supabase.from("worker_ratings").select("rating").eq("worker_id", workerId),
    supabase.rpc("worker_document_checklist", { p_worker_id: workerId }),
  ]);
  const required = (docs.data ?? []).filter((d) => d.required);
  const r = ratings.data ?? [];
  return {
    shifts: done.count ?? 0,
    noShows: noShow.count ?? 0,
    hours30: (hours.data ?? []).reduce((n, t) => n + (t.worked_minutes ?? 0), 0),
    rating: r.length ? r.reduce((n, x) => n + x.rating, 0) / r.length : null,
    ratings: r.length,
    docsDone: required.filter((d) => d.status === "verified" && d.current_version > 0).length,
    docsRequired: required.length,
  };
}

function WorkerHero({ worker, stats, actions }: {
  worker: { first_name: string; last_name: string; worker_number: string | null; engagement_type: string; status: string; email: string | null; phone: string | null; city: string | null; user_id: string | null };
  stats: Awaited<ReturnType<typeof workerStats>>;
  actions: React.ReactNode;
}) {
  const name = `${worker.first_name} ${worker.last_name}`;
  const ini = `${worker.first_name[0] ?? ""}${worker.last_name[0] ?? ""}`.toUpperCase();
  const tiles: { label: string; value: string; hint?: string; tone?: string }[] = [
    { label: "Shifts worked", value: String(stats.shifts) },
    { label: "Hours (30 days)", value: `${Math.floor(stats.hours30 / 60)}:${String(stats.hours30 % 60).padStart(2, "0")}` },
    { label: "Client rating", value: stats.rating != null ? `${stats.rating.toFixed(1)} ★` : "—", hint: stats.ratings ? `${stats.ratings} rating${stats.ratings === 1 ? "" : "s"}` : "No ratings yet" },
    { label: "Required documents", value: `${stats.docsDone}/${stats.docsRequired}`, tone: stats.docsDone < stats.docsRequired ? "text-warning" : "text-success" },
    { label: "No-shows", value: String(stats.noShows), tone: stats.noShows ? "text-danger" : undefined },
  ];
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="h-20 bg-gradient-to-r from-primary via-primary/70 to-primary/30 sm:h-24" aria-hidden />
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <span className="-mt-10 grid size-20 shrink-0 place-items-center rounded-2xl border-4 border-surface sm:-mt-12 bg-gradient-to-br from-navy to-primary text-2xl font-bold text-white shadow-lg sm:size-24" aria-hidden>{ini}</span>
          <div className="min-w-0 flex-1 sm:pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
              <StatusBadge status={worker.status} />
              <Badge tone={worker.engagement_type === "employee" ? "info" : "neutral"}>{worker.engagement_type === "employee" ? "Agency employee" : "Freelancer"}</Badge>
              {!worker.user_id && <Badge tone="warning">No portal account</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{[worker.worker_number, worker.city].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:pb-1">
            {worker.phone && <Button asChild size="sm" variant="secondary"><a href={`tel:${worker.phone}`}><Phone aria-hidden /> Call</a></Button>}
            {worker.email && <Button asChild size="sm" variant="secondary"><a href={`mailto:${worker.email}`}><Mail aria-hidden /> Email</a></Button>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl bg-surface-muted p-3">
              <dt className="text-xs text-muted-foreground">{t.label}</dt>
              <dd className={`text-lg font-semibold tabular-nums ${t.tone ?? ""}`}>{t.value}</dd>
              {t.hint && <dd className="text-[11px] text-muted-foreground">{t.hint}</dd>}
            </div>
          ))}
        </dl>
        <div className="border-t border-border pt-3">{actions}</div>
      </CardContent>
    </Card>
  );
}

function ShiftList({ rows, empty }: { rows: { id: string; status: string; starts_at: string; shift_id: string; shifts: { title: string; clients: { name: string } | null } | null }[]; empty: string }) {
  return !rows.length ? <p className="text-sm text-muted-foreground">{empty}</p> : (
      <ul className="divide-y divide-border">
        {rows.map((a) => (
          <li key={a.id}>
            <Link href={`/admin/shifts/${a.shift_id}`} className="flex items-center gap-2 py-2.5 text-sm hover:text-primary">
              <span className="w-28 shrink-0 text-muted-foreground">{formatDate(a.starts_at)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{a.shifts?.title}<span className="font-normal text-muted-foreground"> · {a.shifts?.clients?.name}</span></span>
              <StatusBadge status={a.status} />
            </Link>
          </li>
        ))}
      </ul>
    );
}

async function Overview({ workerId, worker }: { workerId: string; worker: { email: string | null; phone: string | null; city: string | null; postal_code: string | null; max_travel_km: number | null; professional_summary: string | null; created_at: string; activated_at: string | null } }) {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [upcoming, recent, skills, certs, langs] = await Promise.all([
    supabase.from("shift_assignments").select("id, status, starts_at, ends_at, shift_id, shifts(title, clients(name))").eq("worker_id", workerId).in("status", ["invited", "accepted", "confirmed", "checked_in"]).gte("ends_at", nowIso).order("starts_at").limit(5),
    supabase.from("shift_assignments").select("id, status, starts_at, shift_id, shifts(title, clients(name))").eq("worker_id", workerId).lt("starts_at", nowIso).order("starts_at", { ascending: false }).limit(5),
    supabase.from("worker_skills").select("id, level, is_verified, skills(name)").eq("worker_id", workerId),
    supabase.from("worker_certificates").select("id, status, expires_on, certificates(name)").eq("worker_id", workerId),
    supabase.from("worker_languages").select("id, language_code, level").eq("worker_id", workerId),
  ]);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card><CardHeader><CardTitle>Upcoming shifts</CardTitle></CardHeader><CardContent><ShiftList rows={upcoming.data ?? []} empty="No upcoming shifts." /></CardContent></Card>
        <Card><CardHeader><CardTitle>Recent shifts</CardTitle></CardHeader><CardContent><ShiftList rows={recent.data ?? []} empty="No shifts worked yet." /></CardContent></Card>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Email</dt><dd className="truncate">{worker.email ? <a className="text-primary hover:underline" href={`mailto:${worker.email}`}>{worker.email}</a> : "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt><dd>{worker.phone ? <a className="text-primary hover:underline" href={`tel:${worker.phone}`}>{worker.phone}</a> : "—"}</dd>
              <dt className="text-muted-foreground">Lives in</dt><dd>{[worker.postal_code, worker.city].filter(Boolean).join(" ") || "—"}</dd>
              <dt className="text-muted-foreground">Travels up to</dt><dd>{worker.max_travel_km ? `${worker.max_travel_km} km` : "—"}</dd>
              <dt className="text-muted-foreground">Registered</dt><dd>{formatDate(worker.created_at)}</dd>
              <dt className="text-muted-foreground">Active since</dt><dd>{worker.activated_at ? formatDate(worker.activated_at) : "Not activated"}</dd>
            </dl>
            {worker.professional_summary && <p className="mt-4 rounded-lg bg-surface-muted p-3 text-sm">{worker.professional_summary}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Skills & certificates</CardTitle><Link href="?tab=skills" className="text-sm text-primary">Manage</Link></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {(skills.data ?? []).map((k) => <Badge key={k.id} tone={k.is_verified ? "success" : "neutral"}>{k.skills?.name}{k.level ? ` · ${k.level}` : ""}</Badge>)}
              {(langs.data ?? []).map((l) => <Badge key={l.id}>{l.language_code.toUpperCase()}{l.level ? ` · ${l.level}` : ""}</Badge>)}
              {!skills.data?.length && !langs.data?.length && <span className="text-sm text-muted-foreground">No skills added.</span>}
            </div>
            {!!certs.data?.length && (
              <ul className="divide-y divide-border text-sm">
                {certs.data.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-2"><Award className="size-4 text-muted-foreground" aria-hidden /><span className="flex-1">{c.certificates?.name}</span>{c.expires_on && <span className="text-xs text-muted-foreground">until {formatDate(c.expires_on)}</span>}<StatusBadge status={c.status} /></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
