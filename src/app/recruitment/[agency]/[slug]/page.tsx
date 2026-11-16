import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { getOpening } from "@/lib/data/careers";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { submitApplicationAction } from "./actions";

type Params = Promise<{ agency: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { agency, slug } = await params;
  const o = await getOpening(agency, slug);
  return { title: o ? `${o.title} — ${o.agency_name}` : "Position" };
}

export default async function JobPage({ params }: { params: Params }) {
  const { agency, slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(agency) || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(slug)) notFound();
  const o = await getOpening(agency, slug);
  if (!o) notFound();
  const accepting = isAdminClientConfigured();

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Link href={`/recruitment/${agency}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> All positions</Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{o.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-muted-foreground">
            {o.agency_name}
            {o.location_city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{o.location_city}</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {o.engagement_types.map((e) => <Badge key={e} tone="info">{e === "employee" ? "Employment via the agency" : "Freelance assignment"}</Badge>)}
            {o.hours_indication && <Badge>{o.hours_indication}</Badge>}
            {o.pay_indication && <Badge>{o.pay_indication}</Badge>}
          </div>
        </div>
        <section className="whitespace-pre-wrap text-sm leading-6">{o.description}</section>
        {o.requirements_text && (
          <section>
            <h2 className="mb-1 font-semibold">What we ask</h2>
            <p className="whitespace-pre-wrap text-sm leading-6">{o.requirements_text}</p>
          </section>
        )}
      </div>
      <Card className="h-fit lg:col-span-2">
        <CardHeader><CardTitle>Apply</CardTitle></CardHeader>
        <CardContent>
          {!accepting ? (
            <Alert tone="warning">Online applications are temporarily unavailable. Please try again later.</Alert>
          ) : (
            <ServerForm action={submitApplicationAction.bind(null, agency, slug)} submitLabel="Send application" pendingLabel="Sending…" resetOnSuccess toastOnSuccess={false}>
              <div className="grid grid-cols-2 gap-3">
                <Field name="first_name" label="First name" required><Input name="first_name" autoComplete="given-name" /></Field>
                <Field name="last_name" label="Last name" required><Input name="last_name" autoComplete="family-name" /></Field>
              </div>
              <Field name="email" label="Email" required><Input name="email" type="email" autoComplete="email" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field name="phone" label="Phone"><Input name="phone" type="tel" autoComplete="tel" /></Field>
                <Field name="city" label="City"><Input name="city" autoComplete="address-level2" /></Field>
              </div>
              {o.engagement_types.length > 1 && (
                <Field name="preferred_engagement" label="I would like to work as"><NativeSelect name="preferred_engagement" defaultValue=""><option value="">No preference</option><option value="employee">Employee via the agency</option><option value="freelancer">Freelancer (own business)</option></NativeSelect></Field>
              )}
              <Field name="motivation" label="Motivation"><Textarea name="motivation" rows={4} /></Field>
              <Field name="cv" label="CV (PDF or Word, max 10 MB)"><input name="cv" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary-soft-foreground" /></Field>
              <Field name="source" label="How did you hear about us?"><Input name="source" /></Field>
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              <Field name="privacy" label="Privacy">
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="privacy" className="mt-0.5 size-4 accent-primary" /><span>I have read the <Link href="/privacy" className="text-primary underline" target="_blank">privacy notice</Link> and understand how my data is used for this application.</span></label>
              </Field>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="talent_pool" className="mt-0.5 size-4 accent-primary" /><span>Keep my details for up to one year for other suitable positions (optional).</span></label>
            </ServerForm>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
