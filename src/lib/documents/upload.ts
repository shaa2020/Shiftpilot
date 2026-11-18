import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type ActionState } from "@/lib/actions/state";
import { ALLOWED_UPLOAD, MAX_UPLOAD_BYTES, detectUploadType } from "./detect";
import { scanBytes } from "./scan";

export interface UploadInput {
  agencyId: string;
  userId: string;
  file: FormDataEntryValue | null;
  documentId?: string | null;
  create?: {
    documentTypeId: string;
    ownerType: "worker" | "client" | "freelancer_business";
    workerId?: string | null;
    clientId?: string | null;
    freelancerBusinessId?: string | null;
    title: string;
    issuedOn?: string | null;
    expiresOn?: string | null;
  };
}

/**
 * Stores a new document version as the signed-in user: the documents row,
 * the storage object and the version row are each authorised by RLS/storage
 * policies. File type is checked by content. Path: {agency}/{document}/{uuid}.{ext}
 */
export async function uploadDocumentVersion(input: UploadInput): Promise<ActionState & { documentId?: string }> {
  const file = input.file;
  if (!(file instanceof File) || file.size === 0) return { errors: { file: "Choose a file" } };
  if (file.size > MAX_UPLOAD_BYTES) return { errors: { file: "The file is larger than 10 MB" } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectUploadType(bytes);
  if (!mime) return { errors: { file: "Upload a PDF, JPG, PNG or WebP file" } };
  const scan = await scanBytes(bytes);
  if (scan.status === "infected") {
    console.warn(JSON.stringify({ level: "warn", msg: "upload_rejected_malware", signature: scan.signature, user: input.userId }));
    return { errors: { file: "This file was rejected by the virus scanner." } };
  }
  if (scan.status === "error") return { errors: { file: "The file could not be checked for viruses. Please try again in a moment." } };
  const supabase = await createClient();

  let documentId = input.documentId ?? null;
  if (!documentId && input.create) {
    const c = input.create;
    const { data, error } = await supabase
      .from("documents")
      .insert({
        agency_id: input.agencyId, document_type_id: c.documentTypeId, owner_type: c.ownerType, worker_id: c.workerId ?? null, client_id: c.clientId ?? null,
        freelancer_business_id: c.freelancerBusinessId ?? null, title: c.title, issued_on: c.issuedOn ?? null, expires_on: c.expiresOn ?? null, uploaded_by: input.userId,
      })
      .select("id")
      .single();
    if (error || !data) return { message: dbErrorMessage(error, "The document could not be created.") };
    documentId = data.id;
  }
  if (!documentId) return { message: "Nothing to upload to." };

  const path = `${input.agencyId}/${documentId}/${randomUUID()}.${ALLOWED_UPLOAD[mime]}`;
  const up = await supabase.storage.from("documents").upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return { message: "The file could not be stored. You may not have permission to upload to this document." };
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `document.${ALLOWED_UPLOAD[mime]}`;
  const { error } = await supabase.from("document_versions").insert({
    agency_id: input.agencyId, document_id: documentId, version: 1, storage_path: path, file_name: safeName, mime_type: mime, size_bytes: bytes.length, uploaded_by: input.userId,
    scan_status: scan.status, scan_engine: scan.status === "clean" ? scan.engine : null,
  });
  if (error) return { message: dbErrorMessage(error, "The upload could not be recorded.") };
  return { ok: true, message: "Uploaded. The agency will verify it.", documentId };
}
