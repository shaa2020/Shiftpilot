"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { uploadDocumentVersion } from "@/lib/documents/upload";
import type { ActionState } from "@/lib/actions/state";

const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).transform((v) => (v === "" ? null : v)).optional();

export async function uploadOwnDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireWorker();
  const parsed = z.object({ document_type_id: z.string().uuid(), document_id: z.string().uuid().or(z.literal("")).optional(), issued_on: optDate, expires_on: optDate }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { message: "Invalid upload." };
  const supabase = await createClient();
  const { data: type } = await supabase.from("document_types").select("name, applies_to").eq("id", parsed.data.document_type_id).single();
  if (!type) return { message: "Unknown document type." };
  let businessId: string | null = null;
  if (type.applies_to === "freelancer_business") {
    const { data: biz } = await supabase.from("freelancer_businesses").select("id").eq("worker_id", ctx.workerId).maybeSingle();
    if (!biz) return { message: "Register your business details first." };
    businessId = biz.id;
  }
  const res = await uploadDocumentVersion({
    agencyId: ctx.agencyId, userId: ctx.user.id, file: fd.get("file"), documentId: parsed.data.document_id || null,
    create: { documentTypeId: parsed.data.document_type_id, ownerType: businessId ? "freelancer_business" : "worker", workerId: businessId ? null : ctx.workerId,
              freelancerBusinessId: businessId, title: type.name, issuedOn: parsed.data.issued_on, expiresOn: parsed.data.expires_on },
  });
  if (res.ok) {
    await supabase.from("onboarding_tasks").update({ status: "submitted" }).eq("worker_id", ctx.workerId).eq("task_type", "documents").eq("status", "pending");
    revalidatePath("/worker/documents");
  }
  return res;
}
