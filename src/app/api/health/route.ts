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
  let database: "ok" | "unreachable" = "unreachable";
  try {
    const env = publicEnv();
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(3000), cache: "no-store" });
    database = res.ok ? "ok" : "unreachable";
  } catch {
    database = "unreachable";
  }
  const body = {
    status: database === "ok" ? "ok" : "degraded",
    checks: { supabase: database },
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
