import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Secure document download. The document row and the storage object are both
 * read with the user's session, so RLS and the storage policies decide access.
 * The response is a redirect to a signed URL valid for 2 minutes.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const versionParam = request.nextUrl.searchParams.get("version");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));

  const { data: doc } = await supabase.from("documents").select("id, agency_id, current_version").eq("id", id).maybeSingle();
  if (!doc || doc.current_version === 0) return new NextResponse("Not found", { status: 404 });
  const version = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : doc.current_version;
  const { data: v } = await supabase.from("document_versions").select("storage_bucket, storage_path, file_name").eq("document_id", id).eq("version", version).maybeSingle();
  if (!v) return new NextResponse("Not found", { status: 404 });

  const { data: signed, error } = await supabase.storage.from(v.storage_bucket).createSignedUrl(v.storage_path, 120, { download: v.file_name });
  if (error || !signed) return new NextResponse("Not found", { status: 404 });
  await supabase.rpc("log_audit_event", { p_agency_id: doc.agency_id, p_action: "document.download", p_table: "documents", p_record_id: id, p_context: { version } });
  const res = NextResponse.redirect(signed.signedUrl);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
