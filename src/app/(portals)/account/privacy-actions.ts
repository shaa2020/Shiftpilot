"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMemberships, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, zodErrors, type ActionState } from "@/lib/actions/state";

export async function submitDataRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/account");
  const parsed = z.object({
    agency_id: z.string().uuid("Choose the organisation"),
    request_type: z.enum(["access", "export", "rectification", "erasure", "restriction", "objection"]),
    details: z.string().trim().max(2000).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const m = await getMemberships();
  const agencies = new Set([...m.staffAgencies.map((a) => a.agencyId), ...m.clientMemberships.map((c) => c.agencyId), ...m.workerProfiles.map((w) => w.agencyId)]);
  if (!agencies.has(parsed.data.agency_id)) return { message: "You are not connected to that organisation." };
  const supabase = await createClient();
  const { data: open } = await supabase.from("data_subject_requests").select("id").eq("subject_user_id", user.id).eq("agency_id", parsed.data.agency_id).eq("request_type", parsed.data.request_type).in("status", ["received", "verifying", "in_progress"]).limit(1);
  if (open?.length) return { message: "You already have an open request of this type." };
  const { error } = await supabase.from("data_subject_requests").insert({
    agency_id: parsed.data.agency_id, subject_user_id: user.id, subject_email: user.email, request_type: parsed.data.request_type, details: parsed.data.details || null,
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath("/account");
  return { ok: true, message: "Request sent. The organisation must respond within one month." };
}
