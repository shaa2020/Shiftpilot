import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAssurance } from "@/lib/auth/session";
import { requireUserNoMfa } from "@/lib/auth/mfa";
import { safeNextPath } from "@/lib/auth/portal";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { verifyMfaAction } from "./actions";

export const metadata: Metadata = { title: "Two-factor verification" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  await requireUserNoMfa();
  const aal = await getAssurance();
  if (aal.next !== "aal2" || aal.current === "aal2") redirect(safeNextPath(next));
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Two-factor verification</h1>
        <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <ServerForm action={verifyMfaAction.bind(null, next)} submitLabel="Verify" pendingLabel="Verifying…">
        <Field name="code" label="Code"><Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus /></Field>
      </ServerForm>
      <form action="/auth/signout" method="post"><button className="text-sm text-muted-foreground hover:underline">Sign out</button></form>
    </div>
  );
}
