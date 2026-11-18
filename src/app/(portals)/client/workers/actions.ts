"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, fail, success, type ActionState } from "@/lib/actions/state";

const rateSchema = z.object({
  assignment_id: z.string().uuid(),
  rating: z.coerce.number().int().min(1, "Choose 1 to 5 stars").max(5, "Choose 1 to 5 stars"),
  comment: z.string().trim().max(1000, "Keep it under 1000 characters").optional(),
});

export async function rateAssignmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireClient();
  const p = rateSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Please check the rating.", { rating: p.error.issues[0]?.message ?? "Invalid" });
  const supabase = await createClient();
  const { error } = await supabase.rpc("rate_assignment", { p_assignment_id: p.data.assignment_id, p_rating: p.data.rating, p_comment: p.data.comment ?? "" });
  if (error) return fail(error.code === "22023" || error.code === "42501" ? error.message : dbErrorMessage(error, "The rating could not be saved."));
  revalidatePath("/client/workers");
  return success("Thanks — your rating was saved.");
}

const prefSchema = z.object({
  worker_id: z.string().uuid(),
  kind: z.enum(["preferred", "blocked", "clear"]),
  reason: z.string().trim().max(500).optional(),
});

export async function setPreferenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireClient();
  if (!ctx.capabilities.request) return fail("Your account cannot change worker preferences.");
  const p = prefSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail("Please check the request.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_worker_preference", {
    p_client_id: ctx.clientId,
    p_worker_id: p.data.worker_id,
    p_kind: p.data.kind === "clear" ? (null as unknown as string) : p.data.kind,
    p_reason: p.data.reason ?? "",
  });
  if (error) return fail(error.code === "22023" || error.code === "42501" ? error.message : dbErrorMessage(error));
  revalidatePath("/client/workers");
  return success(
    p.data.kind === "preferred" ? "Marked as preferred — they will be offered your shifts first."
      : p.data.kind === "blocked" ? "Blocked — this worker will no longer be scheduled for you."
        : "Preference removed.",
  );
}
