import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { createShiftAction } from "../actions";

export const metadata: Metadata = { title: "New shift" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function NewShiftPage() {
  const ctx = await requireStaff("shifts.write");
  const supabase = await createClient();
  const [{ data: clients }, { data: positions }] = await Promise.all([
    supabase.from("clients").select("id, name, client_locations(id, name, status)").eq("agency_id", ctx.agencyId).in("status", ["active", "onboarding"]).order("name"),
    supabase.from("job_positions").select("id, name, allows_freelancers, industries(name)").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
  ]);
  const hasLocations = (clients ?? []).some((c) => c.client_locations.some((l) => l.status === "active"));
  if (!hasLocations || !positions?.length) {
    return (
      <>
        <PageHeader title="New shift" />
        <Alert tone="info" title="Set-up needed first">
          {!hasLocations && <p>Add a client with at least one active location.</p>}
          {!positions?.length && <p>Configure at least one job position under Configuration.</p>}
        </Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New shift" description="Times are in the agency time zone. An end time earlier than the start creates an overnight shift." />
      <ServerForm action={createShiftAction} submitLabel="Create shift" pendingLabel="Creating…" toastOnSuccess={false} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Where and when</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="location_id" label="Client location" required className="sm:col-span-2">
              <NativeSelect name="location_id" defaultValue="">
                <option value="" disabled>Choose…</option>
                {(clients ?? []).map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.client_locations.filter((l) => l.status === "active").map((l) => <option key={l.id} value={l.id}>{c.name} — {l.name}</option>)}
                  </optgroup>
                ))}
              </NativeSelect>
            </Field>
            <Field name="title" label="Title" required className="sm:col-span-2"><Input name="title" placeholder="Evening cleaning" /></Field>
            <Field name="date" label="Date" required><Input name="date" type="date" defaultValue={localDate(new Date())} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field name="start_time" label="Start" required><Input name="start_time" type="time" defaultValue="08:00" /></Field>
              <Field name="end_time" label="End" required><Input name="end_time" type="time" defaultValue="16:30" /></Field>
              <Field name="break_minutes" label="Break (min)"><Input name="break_minutes" type="number" min={0} max={240} defaultValue={30} /></Field>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Position</CardTitle><CardDescription>Add more positions on the shift page after creating it.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field name="position_id" label="Position" required><NativeSelect name="position_id" defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...positions.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.industries?.name})</option>)]}</NativeSelect></Field>
            <Field name="headcount" label="Workers needed" required><Input name="headcount" type="number" min={1} max={500} defaultValue={1} /></Field>
            <Field name="required_language_code" label="Required language"><Input name="required_language_code" maxLength={2} placeholder="nl" /></Field>
            <div className="sm:col-span-3"><CheckboxField name="allow_freelancers" label="Also offer to freelancers" description="Only if the position allows freelancers; each freelancer must have an approved classification review." /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="dress_code" label="Dress code"><Input name="dress_code" /></Field>
            <Field name="status" label="Publish">
              <NativeSelect name="status" defaultValue="open"><option value="open">Open — ready for matching</option><option value="draft">Draft — not visible yet</option></NativeSelect>
            </Field>
            <Field name="instructions" label="Instructions for workers" className="sm:col-span-2"><Textarea name="instructions" rows={3} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Repeat (optional)</CardTitle><CardDescription>Creates one shift per selected weekday until the end date (max. 120).</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <fieldset className="flex flex-wrap gap-3">
              <legend className="sr-only">Repeat on</legend>
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" name="repeat_days" value={i + 1} className="accent-primary" />{d}</label>
              ))}
            </fieldset>
            <Field name="repeat_until" label="Until"><Input name="repeat_until" type="date" className="max-w-xs" /></Field>
          </CardContent>
        </Card>
      </ServerForm>
    </>
  );
}
