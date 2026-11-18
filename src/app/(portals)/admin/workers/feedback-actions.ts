"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, fail, success, type ActionState } from "@/lib/actions/state";

const schema = z.object({ client_id: z.string().uuid(), worker_id: z.string().uuid() });

/** Removes a client's preferred / blocked mark (staff with clients.write). */
export async function clearPreferenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireStaff("clients.write");
  const p = schema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail("Unknown preference.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_worker_preference", { p_client_id: p.data.client_id, p_worker_id: p.data.worker_id, p_kind: null as unknown as string });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/admin/workers/${p.data.worker_id}`);
  return success("Preference removed.");
}
