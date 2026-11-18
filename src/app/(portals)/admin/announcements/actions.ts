"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localInputToIso } from "@/lib/time";
import { dbErrorMessage, fail, success, zodErrors, type ActionState } from "@/lib/actions/state";

const schema = z.object({
  title: z.string().trim().min(1, "Add a title").max(160, "Keep the title under 160 characters"),
  body: z.string().trim().min(1, "Write the announcement").max(5000, "Keep it under 5000 characters"),
  audience: z.enum(["everyone", "workers", "clients", "staff"], { message: "Choose who should see it" }),
  pinned: z.literal("on").optional(),
  expires_at: z.string().optional(),
});

function refresh() {
  revalidatePath("/admin/announcements");
  revalidatePath("/worker");
  revalidatePath("/client");
}

export async function publishAnnouncementAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("notifications.manage");
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail("Please correct the highlighted fields.", zodErrors(parsed.error));
  const d = parsed.data;
  const expires = d.expires_at ? localInputToIso(d.expires_at) : null;
  if (expires && new Date(expires) <= new Date()) return fail("The end date must be in the future.", { expires_at: "Choose a future date and time" });
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    agency_id: ctx.agencyId, title: d.title, body: d.body, audience: d.audience, pinned: d.pinned === "on", expires_at: expires, created_by: ctx.user.id,
  });
  if (error) return fail(dbErrorMessage(error, "The announcement could not be published."));
  refresh();
  return success("Announcement published and the audience notified.");
}

const idSchema = z.object({ id: z.string().uuid() });

export async function togglePinAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("notifications.manage");
  const p = idSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail("Unknown announcement.");
  const supabase = await createClient();
  const { data: cur } = await supabase.from("announcements").select("pinned").eq("id", p.data.id).eq("agency_id", ctx.agencyId).maybeSingle();
  if (!cur) return fail("Unknown announcement.");
  const { error } = await supabase.from("announcements").update({ pinned: !cur.pinned }).eq("id", p.data.id);
  if (error) return fail(dbErrorMessage(error));
  refresh();
  return success(cur.pinned ? "Unpinned." : "Pinned to the top.");
}

export async function endAnnouncementAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("notifications.manage");
  const p = idSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail("Unknown announcement.");
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").delete().eq("id", p.data.id).eq("agency_id", ctx.agencyId);
  if (error) return fail(dbErrorMessage(error));
  refresh();
  return success("Announcement removed.");
}
