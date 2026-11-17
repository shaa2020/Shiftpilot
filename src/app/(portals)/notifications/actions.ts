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

const CHANNELS = ["email", "push", "whatsapp"] as const;

export async function savePreferencesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/notifications/preferences");
  const agencyId = z.string().uuid().safeParse(fd.get("agency_id"));
  if (!agencyId.success) return { message: "Choose an organisation." };
  const events = z.array(z.string().regex(/^(\*|[a-z_]+(\.[a-z_]+)*)$/)).max(60).parse(fd.getAll("event"));
  const rows = events.flatMap((event) => CHANNELS.map((channel) => ({
    user_id: user.id, agency_id: agencyId.data, event_type: event, channel, enabled: fd.get(`${event}:${channel}`) === "on",
  })));
  const supabase = await createClient();
  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "user_id,agency_id,event_type,channel" });
  if (error) return { message: "Your preferences could not be saved." };
  revalidatePath("/notifications/preferences");
  return { ok: true, message: "Preferences saved." };
}

export async function registerPushAction(sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string }): Promise<ActionState> {
  await requireUser("/notifications/preferences");
  const parsed = z.object({ endpoint: z.string().url().startsWith("https://").max(1000), p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100), userAgent: z.string().max(300).optional() }).safeParse(sub);
  if (!parsed.success) return { message: "This browser returned an invalid push subscription." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_push_subscription", { p_endpoint: parsed.data.endpoint, p_p256dh: parsed.data.p256dh, p_auth: parsed.data.auth, p_user_agent: parsed.data.userAgent });
  if (error) return { message: "Push notifications could not be enabled." };
  revalidatePath("/notifications/preferences");
  return { ok: true, message: "Push notifications enabled on this device." };
}

export async function disablePushAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser("/notifications/preferences");
  const supabase = await createClient();
  const id = z.string().uuid().parse(fd.get("id"));
  const { error } = await supabase.from("push_subscriptions").update({ disabled_at: new Date().toISOString() }).eq("id", id);
  if (error) return { message: "Could not remove the device." };
  revalidatePath("/notifications/preferences");
  return { ok: true, message: "Device removed." };
}
