import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Data subject access export (JSON). Runs with the signed-in privacy officer's
 * session; the database checks gdpr.manage and writes an audit entry.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireStaff("gdpr.manage");
  const email = z.string().email().safeParse(request.nextUrl.searchParams.get("email"));
  if (!email.success) return new NextResponse("Invalid email", { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_subject_data", { p_agency_id: ctx.agencyId, p_email: email.data });
  if (error) return new NextResponse("Export failed", { status: error.code === "42501" ? 403 : 500 });
  const name = `subject-export-${email.data.replace(/[^a-z0-9]+/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
