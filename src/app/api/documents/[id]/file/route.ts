import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Streams a document version for in-app preview (images) or opening in a new
 * tab (PDF). Read with the user's session: RLS and storage policies decide
 * access, and the view is audited like a download.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  const { data: doc } = await supabase.from("documents").select("id, agency_id, current_version").eq("id", id).maybeSingle();
  if (!doc || doc.current_version === 0) return new NextResponse("Not found", { status: 404 });
  const vp = request.nextUrl.searchParams.get("version");
  const version = vp && /^\d+$/.test(vp) ? Number(vp) : doc.current_version;
  const { data: v } = await supabase.from("document_versions").select("storage_bucket, storage_path, file_name, mime_type").eq("document_id", id).eq("version", version).maybeSingle();
  if (!v) return new NextResponse("Not found", { status: 404 });
  // A 60-second signed URL (authorised by the storage policies) fetched server-side,
  // so the browser never sees a storage URL and the file is served from this origin.
  const { data: signed, error } = await supabase.storage.from(v.storage_bucket).createSignedUrl(v.storage_path, 60);
  if (error || !signed) return new NextResponse("Not found", { status: 404 });
  const file = await fetch(signed.signedUrl, { cache: "no-store" });
  if (!file.ok || !file.body) return new NextResponse("Not found", { status: 404 });
  await supabase.rpc("log_audit_event", { p_agency_id: doc.agency_id, p_action: "document.view", p_table: "documents", p_record_id: id, p_context: { version } });
  const safe = v.file_name.replace(/["\\\r\n]/g, "_");
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": v.mime_type,
      "Content-Disposition": `inline; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
