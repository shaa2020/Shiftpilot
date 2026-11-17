"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/actions/state";

export async function markReadAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser("/notifications");
  const supabase = await createClient();
  const id = fd.get("id");
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (id) q = q.eq("id", z.string().uuid().parse(id));
  const { error } = await q;
  if (error) return { ok: false, message: "Could not update notifications." };
  revalidatePath("/", "layout");
  return { ok: true, message: id ? "Marked as read." : "All marked as read." };
}
