import { NextResponse, type NextRequest } from "next/server";
import { isAuthorisedCron } from "@/lib/automation/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shift reminders, missing check-ins, document expiry, overdue invoices, invitation expiry, retention. */
export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request.headers.get("authorization"))) return new NextResponse("Unauthorized", { status: 401 });
  const { data, error } = await createAdminClient().rpc("run_scheduled_automations");
  if (error) {
    console.error("[cron:automations]", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: data });
}
