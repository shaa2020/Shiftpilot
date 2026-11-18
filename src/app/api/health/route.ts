import { NextResponse } from "next/server";
import { publicEnv, serverEnv, vapidPublicKey } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe. Checks the database through the public REST
 * endpoint (no credentials beyond the anon key) and reports which optional
 * integrations are configured — never their values.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "unreachable" | "auth_rejected" = "unreachable";
  let configError: string | null = null;
  const keyKind = (v: string | undefined) => (!v ? "missing" : v.startsWith("eyJ") ? "jwt" : v.startsWith("sb_publishable_") ? "publishable" : v.startsWith("sb_secret_") ? "secret" : "unrecognised");
  try {
    const env = publicEnv();
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(3000), cache: "no-store" });
    database = res.ok ? "ok" : res.status === 401 || res.status === 403 ? "auth_rejected" : "unreachable";
  } catch (e) {
    database = "unreachable";
    configError = e instanceof Error && e.message.startsWith("Invalid public environment") ? e.message.replace(/ See ENVIRONMENT\.md\.$/, "") : null;
  }
  const body = {
    status: database === "ok" ? "ok" : "degraded",
    checks: { supabase: database, ...(configError ? { config: configError } : {}) },
    config: {
      supabaseUrlSet: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      anonKey: keyKind(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      serviceRoleKey: keyKind(process.env.SUPABASE_SERVICE_ROLE_KEY),
      appUrlSource: process.env.NEXT_PUBLIC_APP_URL ? "NEXT_PUBLIC_APP_URL" : process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL ? "vercel" : "missing",
    },
    integrations: {
      serviceRole: Boolean(serverEnv.supabaseServiceRoleKey()),
      email: Boolean(serverEnv.resendApiKey() && serverEnv.emailFrom()),
      push: Boolean(vapidPublicKey() && serverEnv.vapidPrivateKey()),
      whatsapp: Boolean(serverEnv.whatsappToken()),
      cron: Boolean(serverEnv.cronSecret()),
      assistant: Boolean(serverEnv.anthropicApiKey()),
      errorReporting: Boolean(serverEnv.sentryDsn()),
    },
    durationMs: Date.now() - started,
  };
  return NextResponse.json(body, { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
