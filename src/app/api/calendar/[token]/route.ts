import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { buildIcs } from "@/lib/calendar/ics";
import type { Database } from "@/lib/database.types";

/**
 * Personal shift calendar (ICS) for calendar apps, which cannot sign in. The
 * secret token in the URL is the credential; the database stores only its
 * hash and returns only that worker's own shifts. Uses the public anon key —
 * never the service role.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = token.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(raw)) return new NextResponse("Not found", { status: 404 });
  const env = publicEnv();
  const supabase = createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const hash = createHash("sha256").update(raw).digest("hex");
  const { data, error } = await supabase.rpc("calendar_feed_events", { p_token_hash: hash });
  if (error) return new NextResponse("Calendar unavailable", { status: 503 });
  const ics = buildIcs(
    "ShiftPilot shifts",
    (data ?? []).map((e) => ({
      uid: `${e.assignment_id}@shiftpilot`,
      start: e.starts_at,
      end: e.ends_at,
      summary: `${e.title} · ${e.client_name}`,
      location: [e.location_name, e.location_address].filter(Boolean).join(", "),
      description: [`Position: ${e.position_name}`, `Status: ${e.status.replace(/_/g, " ")}`, e.instructions].filter(Boolean).join("\n"),
      updated: e.updated_at,
    })),
  );
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="shifts.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
