import type { Metadata } from "next";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { createRequestAction } from "../../actions";

export const metadata: Metadata = { title: "Request staff" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function NewRequestPage() {
  const ctx = await requireClient();
  if (!ctx.capabilities.request) return <Alert tone="warning">Your account is not allowed to request staff. Ask your administrator.</Alert>;
  const supabase = await createClient();
  const [{ data: locations }, { data: positions }, { data: skills }] = await Promise.all([
    supabase.from("client_locations").select("id, name").eq("client_id", ctx.clientId).eq("status", "active").order("name"),
    supabase.from("job_positions").select("id, name, industries(name)").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    supabase.from("skills").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
  ]);
  if (!locations?.length) return <Alert tone="warning">No locations are available to your account. Contact the agency.</Alert>;
  return (
    <>
      <PageHeader title="Request staff" description="The agency reviews your request and confirms the workers." />
      <ServerForm action={createRequestAction} submitLabel="Send request" pendingLabel="Sending…" toastOnSuccess={false} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>What and where</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field name="location_id" label="Location" required><NativeSelect name="location_id">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></Field>
            <Field name="position_id" label="Job position" required><NativeSelect name="position_id" defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...(positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.industries?.name})</option>)]}</NativeSelect></Field>
            <Field name="headcount" label="Number of workers" required><Input name="headcount" type="number" min={1} max={500} defaultValue={1} /></Field>
            <div className="flex items-end"><CheckboxField name="is_urgent" label="Urgent request" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>When</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4">
            <Field name="date" label="Date" required><Input name="date" type="date" min={localDate(new Date())} /></Field>
            <Field name="start_time" label="Start" required><Input name="start_time" type="time" defaultValue="08:00" /></Field>
            <Field name="end_time" label="End" required><Input name="end_time" type="time" defaultValue="16:30" /></Field>
            <Field name="break_minutes" label="Break (minutes)"><Input name="break_minutes" type="number" min={0} max={240} defaultValue={30} /></Field>
            <fieldset className="flex flex-wrap items-center gap-3 sm:col-span-3">
              <legend className="mb-1 text-sm font-medium">Repeat weekly on (optional)</legend>
              {DAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" name="repeat_days" value={i + 1} className="accent-primary" />{d}</label>)}
            </fieldset>
            <Field name="repeat_until" label="Repeat until"><Input name="repeat_until" type="date" /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Requirements</CardTitle><CardDescription>Only what the work genuinely requires.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {!!skills?.length && (
              <fieldset className="sm:col-span-2">
                <legend className="mb-1 text-sm font-medium">Skills</legend>
                <div className="flex flex-wrap gap-3">{skills.map((s) => <label key={s.id} className="flex items-center gap-1 text-sm"><input type="checkbox" name="required_skill_ids" value={s.id} className="accent-primary" />{s.name}</label>)}</div>
              </fieldset>
            )}
            <Field name="required_language_code" label="Language" hint="Two-letter code, e.g. nl or en"><Input name="required_language_code" maxLength={2} /></Field>
            <Field name="min_experience_months" label="Minimum experience (months)"><Input name="min_experience_months" type="number" min={0} /></Field>
            <Field name="client_reference" label="Your reference / PO number"><Input name="client_reference" /></Field>
            <Field name="instructions" label="Instructions for workers" className="sm:col-span-2"><Textarea name="instructions" rows={3} /></Field>
            <Field name="submit" label="Save as"><NativeSelect name="submit" defaultValue="submitted"><option value="submitted">Send to agency now</option><option value="draft">Draft (send later)</option></NativeSelect></Field>
          </CardContent>
        </Card>
      </ServerForm>
    </>
  );
}
