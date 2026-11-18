"use server";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { dbErrorMessage, fail, success, type ActionState } from "@/lib/actions/state";

/** Creates (or replaces) the worker's secret calendar link. Only its hash is stored. */
export async function createCalendarFeedAction(): Promise<ActionState> {
  const ctx = await requireWorker();
  const token = randomBytes(32).toString("base64url");
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_feeds")
    .upsert({ user_id: ctx.user.id, token_hash: createHash("sha256").update(token).digest("hex"), created_at: new Date().toISOString(), last_used_at: null }, { onConflict: "user_id" });
  if (error) return fail(dbErrorMessage(error, "The calendar link could not be created."));
  revalidatePath("/worker/schedule");
  return success("Calendar link created. Copy it now — it is shown only once.", { url: `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/calendar/${token}.ics` });
}

export async function deleteCalendarFeedAction(): Promise<ActionState> {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const { error } = await supabase.from("calendar_feeds").delete().eq("user_id", ctx.user.id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/worker/schedule");
  return success("Calendar link turned off. Calendars using it stop updating.");
}
