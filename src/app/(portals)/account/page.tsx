import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { submitDataRequestAction } from "./privacy-actions";
import { Alert } from "@/components/ui/alert";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { MfaSetup } from "@/components/auth/mfa-setup";
import { confirmTotpAction, enrollTotpAction, removeFactorAction } from "@/app/(auth)/mfa/actions";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { PasswordForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Account & security" };

const EVENT_LABEL: Record<string, string> = {
  sign_in: "Signed in", sign_out: "Signed out", password_changed: "Password changed",
  password_reset_requested: "Password reset requested", sign_in_failed: "Failed sign-in",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ mfa?: string }> }) {
  const user = await requireUser("/account");
  const { mfa } = await searchParams;
  const supabase = await createClient();
  const { data: factorData } = await supabase.auth.mfa.listFactors();
  const factors = (factorData?.totp ?? []).filter((f) => f.status === "verified");
  const [{ data: profile }, { data: events }, { data: requests }, { data: agencyRows }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, locale, email").eq("id", user.id).single(),
    supabase.from("user_sessions").select("id, event, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("data_subject_requests").select("id, request_type, status, due_at, outcome, created_at").eq("subject_user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.rpc("my_agencies"),
  ]);
  const agencies = new Map<string, string>((agencyRows ?? []).map((a) => [a.agency_id, a.name]));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/portal" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      <PageHeader title="Account & security" actions={<ThemeToggle />} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>{profile && <ProfileForm profile={profile} />}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Password</CardTitle><CardDescription>At least 12 characters.</CardDescription></CardHeader>
          <CardContent><PasswordForm /></CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Two-factor authentication</CardTitle><CardDescription>Protects your account with a code from an authenticator app in addition to your password.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {mfa === "required" && factors.length === 0 && <Alert tone="warning">Your agency requires two-factor authentication for staff. Set it up to continue to Admin HQ.</Alert>}
            {factors.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {factors.map((f) => (
                  <li key={f.id} className="flex items-center justify-between py-2">
                    <span>{f.friendly_name ?? "Authenticator app"} · added {formatDate(f.created_at)}</span>
                    <ConfirmAction action={removeFactorAction} fields={{ id: f.id }} title="Turn off two-factor authentication?" description="Your account will be protected by your password only." destructive variant="ghost" confirmLabel="Turn off">Remove</ConfirmAction>
                  </li>
                ))}
              </ul>
            ) : <MfaSetup enroll={enrollTotpAction} confirm={confirmTotpAction} />}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Recent security activity</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {(events ?? []).map((e) => (
                <li key={e.id} className="flex justify-between py-2">
                  <span>{EVENT_LABEL[e.event] ?? e.event}</span>
                  <span className="text-muted-foreground">{formatDateTime(e.created_at)}</span>
                </li>
              ))}
              {(!events || events.length === 0) && <li className="py-2 text-muted-foreground">No activity recorded yet.</li>}
            </ul>
          </CardContent>
        </Card>
        {agencies.size > 0 && (
          <Card className="md:col-span-2">
            <CardHeader><CardTitle>Your personal data</CardTitle><CardDescription>Ask for a copy of your data, a correction, or erasure. Some records (contracts, payroll, invoices) must be kept by law and are listed in the response.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {!!requests?.length && (
                <ul className="divide-y divide-border text-sm">
                  {requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{humanize(r.request_type)} · requested {formatDate(r.created_at)}{r.outcome ? ` · ${r.outcome}` : ` · due ${formatDate(r.due_at)}`}</span>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
              <ServerForm action={submitDataRequestAction} submitLabel="Send request" resetOnSuccess className="grid gap-3 sm:grid-cols-2" footerClassName="sm:col-span-2">
                <Field name="agency_id" label="Organisation"><NativeSelect name="agency_id" defaultValue={agencies.size === 1 ? [...agencies.keys()][0] : ""}>{[<option key="" value="" disabled>Choose…</option>, ...[...agencies].map(([id, name]) => <option key={id} value={id}>{name}</option>)]}</NativeSelect></Field>
                <Field name="request_type" label="Request"><NativeSelect name="request_type" defaultValue="access"><option value="access">Access — see my data</option><option value="export">Export — a copy of my data</option><option value="rectification">Correct my data</option><option value="erasure">Erase my data</option><option value="restriction">Restrict processing</option><option value="objection">Object to processing</option></NativeSelect></Field>
                <div className="sm:col-span-2"><Field name="details" label="Details (optional)"><Textarea name="details" rows={2} /></Field></div>
              </ServerForm>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
