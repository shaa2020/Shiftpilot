"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUserNoMfa } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/portal";
import { rateLimit } from "@/lib/security/request";
import type { ActionState } from "@/lib/actions/state";

const code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");

export async function verifyMfaAction(next: string | undefined, _p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUserNoMfa();
  const parsed = code.safeParse(fd.get("code"));
  if (!parsed.success) return { errors: { code: parsed.error.issues[0].message } };
  if (!(await rateLimit("mfa-verify", user.id, 10, 900))) return { message: "Too many attempts. Wait 15 minutes and try again." };
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect(safeNextPath(next));
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data });
  if (error) return { errors: { code: "That code is not valid. Check the time on your phone and try again." } };
  redirect(safeNextPath(next));
}

export async function enrollTotpAction(): Promise<{ ok: true; factorId: string; qr: string; secret: string } | { ok: false; message: string }> {
  await requireUserNoMfa();
  const supabase = await createClient();
  // Remove abandoned, unverified enrolments first (Supabase limits the number of factors).
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { ok: false, message: "Two-factor setup could not be started." };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmTotpAction(factorId: string, value: string): Promise<ActionState> {
  const user = await requireUserNoMfa();
  const parsed = code.safeParse(value);
  if (!parsed.success || !z.string().uuid().safeParse(factorId).success) return { message: "Enter the 6-digit code." };
  if (!(await rateLimit("mfa-verify", user.id, 10, 900))) return { message: "Too many attempts. Wait 15 minutes." };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: parsed.data });
  if (error) return { message: "That code is not valid." };
  return { ok: true, message: "Two-factor authentication is on." };
}

export async function removeFactorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireUserNoMfa();
  const factorId = z.string().uuid().parse(fd.get("id"));
  const supabase = await createClient();
  // Supabase requires an aal2 session to remove a verified factor.
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { message: "The factor could not be removed. Sign in with your code first." };
  return { ok: true, message: "Two-factor authentication removed." };
}
