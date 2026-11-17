import { NextResponse, type NextRequest } from "next/server";
import { isAuthorisedCron } from "@/lib/automation/cron-auth";
import { dispatchDeliveries } from "@/lib/automation/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sends queued email/push/WhatsApp deliveries. Scheduled by vercel.json. */
export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request.headers.get("authorization"))) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const result = await dispatchDeliveries(100);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron:dispatch]", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
