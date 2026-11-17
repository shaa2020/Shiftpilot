"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, type ActionState } from "@/lib/actions/state";
import { uploadDocumentVersion } from "@/lib/documents/upload";

const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional().transform((v) => (v ? v : null));

export async function verifyDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("documents.verify");
  const parsed = z.object({ id: z.string().uuid(), approve: z.enum(["true", "false"]), expires_on: optDate, reason: z.string().max(500).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { message: "Invalid request." };
  const approve = parsed.data.approve === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_document", { p_document_id: parsed.data.id, p_approve: approve, p_expires_on: parsed.data.expires_on ?? undefined, p_reason: parsed.data.reason || undefined });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/documents");
  revalidatePath("/admin/workers", "layout");
  return { ok: true, message: approve ? "Document verified." : "Document rejected; the worker was notified." };
}

/** Staff upload for a worker or client document (new document or new version). */
export async function staffUploadDocumentAction(owner: { workerId?: string; clientId?: string }, _p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("documents.upload");
  const parsed = z.object({ document_type_id: z.string().uuid(), document_id: z.string().uuid().or(z.literal("")).optional(), title: z.string().max(200).optional(), issued_on: optDate, expires_on: optDate }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { message: "Invalid upload." };
  const supabase = await createClient();
  const { data: type } = await supabase.from("document_types").select("name, applies_to").eq("id", parsed.data.document_type_id).single();
  if (!type) return { message: "Unknown document type." };
  const res = await uploadDocumentVersion({
    agencyId: ctx.agencyId, userId: ctx.user.id, file: fd.get("file"), documentId: parsed.data.document_id || null,
    create: { documentTypeId: parsed.data.document_type_id, ownerType: owner.clientId ? "client" : "worker", workerId: owner.workerId ?? null, clientId: owner.clientId ?? null,
              title: parsed.data.title?.trim() || type.name, issuedOn: parsed.data.issued_on, expiresOn: parsed.data.expires_on },
  });
  if (res.ok) {
    revalidatePath("/admin/documents");
    if (owner.workerId) revalidatePath(`/admin/workers/${owner.workerId}`);
    if (owner.clientId) revalidatePath(`/admin/clients/${owner.clientId}`);
    return { ok: true, message: "Uploaded." };
  }
  return res;
}
