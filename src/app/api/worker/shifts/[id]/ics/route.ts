import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildIcs } from "@/lib/calendar/ics";

/** One shift as an .ics file for the signed-in worker (RLS: own assignments only). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/login?next=/worker/shifts/${id}`, request.url));
  const { data: a } = await supabase
    .from("shift_assignments")
    .select("id, status, starts_at, ends_at, updated_at, workers!inner(user_id), shifts(title, instructions, dress_code, clients(name), client_locations(name, address_line1, postal_code, city)), shift_positions(job_positions(name))")
    .eq("id", id)
    .eq("workers.user_id", auth.user.id)
    .maybeSingle();
  if (!a?.shifts) return new NextResponse("Not found", { status: 404 });
  const s = a.shifts;
  const loc = s.client_locations;
  const ics = buildIcs(s.title, [{
    uid: `${a.id}@shiftpilot`,
    start: a.starts_at,
    end: a.ends_at,
    summary: `${s.title} · ${s.clients?.name ?? ""}`.trim(),
    location: loc ? [loc.name, loc.address_line1, [loc.postal_code, loc.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null,
    description: [a.shift_positions?.job_positions?.name && `Position: ${a.shift_positions.job_positions.name}`, s.dress_code && `Dress code: ${s.dress_code}`, s.instructions].filter(Boolean).join("\n"),
    updated: a.updated_at,
    cancelled: ["cancelled", "replaced", "declined"].includes(a.status),
  }]);
  return new NextResponse(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="shift-${a.starts_at.slice(0, 10)}.ics"`, "Cache-Control": "private, no-store" },
  });
}
