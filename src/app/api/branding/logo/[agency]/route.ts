import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/** Agency logo for signed-in agency participants (RLS decides). Cached per version (?v=). */
export async function GET(_req: Request, { params }: { params: Promise<{ agency: string }> }) {
  const { agency } = await params;
  if (!z.string().uuid().safeParse(agency).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("agency_branding").select("logo_data, logo_mime").eq("agency_id", agency).maybeSingle();
  if (!data?.logo_data || !data.logo_mime) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(data.logo_data, "base64"), {
    headers: {
      "Content-Type": data.logo_mime,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
