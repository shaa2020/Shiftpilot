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

function refreshDocs(workerIds: string[] = []) {
  revalidatePath("/admin/documents", "layout");
  for (const w of workerIds) revalidatePath(`/admin/workers/${w}`);
}

const requestSchema = z.object({
  target: z.enum(["selected", "missing_required"]).default("selected"),
  worker_ids: z.array(z.string().uuid()).default([]),
  document_type_id: z.string().uuid().or(z.literal("")).optional(),
  title: z.string().trim().max(160).optional(),
  message: z.string().trim().max(2000).optional(),
  due_on: optDate,
});

/**
 * Requests a document from the chosen workers, or from every active worker
 * who is missing a required document of the chosen type.
 */
export async function requestDocumentsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("documents.upload");
  const parsed = requestSchema.safeParse({
    target: fd.get("target") || "selected",
    worker_ids: fd.getAll("worker_ids").map(String).filter(Boolean),
    document_type_id: fd.get("document_type_id") ?? "",
    title: fd.get("title") ?? "",
    message: fd.get("message") ?? "",
    due_on: fd.get("due_on") ?? "",
  });
  if (!parsed.success) return { message: "Please check the request." };
  const d = parsed.data;
  if (!d.document_type_id && (d.title ?? "").length < 3) return { message: "Choose a document type or describe the document.", errors: { title: "Describe the document you need" } };
  const supabase = await createClient();
  let workerIds = d.worker_ids;
  if (d.target === "missing_required") {
    if (!d.document_type_id) return { message: "Choose the document type to request.", errors: { document_type_id: "Choose a type" } };
    const { data: workers } = await supabase.from("workers").select("id, engagement_type").eq("agency_id", ctx.agencyId).in("status", ["active", "onboarding"]).limit(2000);
    const { data: type } = await supabase.from("document_types").select("required_for_engagement").eq("id", d.document_type_id).single();
    const { data: have } = await supabase.from("documents").select("worker_id").eq("document_type_id", d.document_type_id).is("archived_at", null).gt("current_version", 0).in("status", ["pending", "verified"]);
    const has = new Set((have ?? []).map((h) => h.worker_id));
    const req = new Set(type?.required_for_engagement ?? []);
    workerIds = (workers ?? []).filter((w) => !has.has(w.id) && (req.size === 0 || req.has(w.engagement_type))).map((w) => w.id);
    if (!workerIds.length) return { ok: true, message: "Every worker already has this document." };
  }
  if (!workerIds.length) return { message: "Choose at least one worker.", errors: { worker_ids: "Choose at least one worker" } };
  const { data: count, error } = await supabase.rpc("request_documents", {
    p_agency_id: ctx.agencyId, p_worker_ids: workerIds, p_document_type_id: d.document_type_id || (null as unknown as string),
    p_title: d.title ?? "", p_message: d.message ?? "", p_due_on: d.due_on ?? (null as unknown as string),
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshDocs(workerIds.slice(0, 20));
  if (!count) return { ok: true, message: "Nothing new to request — these workers already have an open request for it." };
  return { ok: true, message: `Requested from ${count} worker${count === 1 ? "" : "s"}. They have been notified.` };
}

const idOnly = z.object({ id: z.string().uuid(), reason: z.string().max(500).optional(), worker_id: z.string().uuid().optional() });

export async function cancelRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("documents.upload");
  const p = idOnly.safeParse(Object.fromEntries(fd));
  if (!p.success) return { message: "Unknown request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_document_request", { p_request_id: p.data.id, p_reason: p.data.reason ?? "" });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshDocs(p.data.worker_id ? [p.data.worker_id] : []);
  return { ok: true, message: "Request cancelled." };
}

export async function remindRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("documents.upload");
  const p = idOnly.safeParse(Object.fromEntries(fd));
  if (!p.success) return { message: "Unknown request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remind_document_request", { p_request_id: p.data.id });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshDocs();
  return { ok: true, message: "Reminder sent." };
}

export async function archiveDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("documents.upload");
  const p = idOnly.safeParse(Object.fromEntries(fd));
  if (!p.success) return { message: "Unknown document." };
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update({ archived_at: new Date().toISOString() }).eq("id", p.data.id).eq("agency_id", ctx.agencyId);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshDocs(p.data.worker_id ? [p.data.worker_id] : []);
  return { ok: true, message: "Document archived. Its file history is kept." };
}

export async function updateDocumentDetailsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("documents.verify");
  const p = z.object({ id: z.string().uuid(), title: z.string().trim().min(1, "Give the document a name").max(200), issued_on: optDate, expires_on: optDate }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { message: "Please check the details.", errors: { title: p.error.issues[0]?.message } };
  if (p.data.issued_on && p.data.expires_on && p.data.expires_on < p.data.issued_on) return { message: "The expiry date is before the issue date.", errors: { expires_on: "Must be after the issue date" } };
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update({ title: p.data.title, issued_on: p.data.issued_on, expires_on: p.data.expires_on }).eq("id", p.data.id).eq("agency_id", ctx.agencyId);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshDocs();
  return { ok: true, message: "Details saved." };
}

const typeSchema = z.object({
  name: z.string().trim().min(2, "Give the type a name").max(120),
  applies_to: z.enum(["worker", "freelancer_business"]),
  required_employee: z.literal("on").optional(),
  required_freelancer: z.literal("on").optional(),
  requires_expiry: z.literal("on").optional(),
  is_sensitive: z.literal("on").optional(),
  retention_months: z.coerce.number().int().min(1).max(1200).optional().or(z.literal("").transform(() => undefined)),
});

export async function createDocumentTypeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("agency.settings.manage");
  const p = typeSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { message: "Please check the document type.", errors: { name: p.error.issues[0]?.message } };
  const d = p.data;
  const required = [d.required_employee && "employee", d.required_freelancer && "freelancer"].filter(Boolean) as ("employee" | "freelancer")[];
  const key = d.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "document";
  const supabase = await createClient();
  const { error } = await supabase.from("document_types").insert({
    agency_id: ctx.agencyId, key: `${key}_${Date.now().toString(36).slice(-4)}`, name: d.name, applies_to: d.applies_to,
    required_for_engagement: required.length ? required : null, requires_expiry: !!d.requires_expiry, is_sensitive: !!d.is_sensitive,
    retention_months: d.retention_months ?? null,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshDocs();
  return { ok: true, message: "Document type added. Workers see it in their checklist." };
}

export async function toggleDocumentTypeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("agency.settings.manage");
  const p = z.object({ id: z.string().uuid(), status: z.enum(["active", "inactive"]) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { message: "Unknown type." };
  const supabase = await createClient();
  const { error } = await supabase.from("document_types").update({ status: p.data.status }).eq("id", p.data.id).eq("agency_id", ctx.agencyId);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  refreshDocs();
  return { ok: true, message: p.data.status === "active" ? "Type activated." : "Type hidden from new checklists." };
}
