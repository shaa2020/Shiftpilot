"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, fail, success, type ActionState } from "@/lib/actions/state";

const PORTAL = z.enum(["admin", "worker", "client"]);
const startSchema = z.object({
  portal: PORTAL,
  agency_id: z.string().uuid(),
  subject: z.string().trim().max(160).optional().default(""),
  body: z.string().trim().min(1, "Write a message").max(5000, "Keep it under 5000 characters"),
  worker_id: z.string().uuid().optional().or(z.literal("")),
  client_id: z.string().uuid().optional().or(z.literal("")),
  recipient: z.string().optional(),
});

/** Starts a conversation. The database decides who may message whom. */
export async function startConversationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const raw = Object.fromEntries(fd) as Record<string, string>;
  // Staff pick "worker:<id>" or "client:<id>" from one list.
  if (raw.recipient) {
    const [kind, id] = raw.recipient.split(":");
    if (kind === "worker") raw.worker_id = id ?? "";
    if (kind === "client") raw.client_id = id ?? "";
  }
  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) return fail("Please check the message.", { body: parsed.error.issues[0]?.message ?? "Invalid" });
  const d = parsed.data;
  if (d.portal === "admin" && !d.worker_id && !d.client_id) return fail("Choose who to message.", { recipient: "Choose a worker or client" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_conversation", {
    p_agency_id: d.agency_id,
    p_subject: d.subject,
    p_body: d.body,
    p_worker_id: d.worker_id || undefined,
    p_client_id: d.client_id || undefined,
  });
  if (error || !data) return fail(error?.code === "22023" || error?.code === "42501" ? error.message : dbErrorMessage(error, "The message could not be sent."));
  revalidatePath(`/${d.portal}/messages`);
  redirect(`/${d.portal}/messages/${data}`);
}

const sendSchema = z.object({
  portal: PORTAL,
  conversation_id: z.string().uuid(),
  body: z.string().trim().min(1, "Write a message").max(5000, "Keep it under 5000 characters"),
  internal: z.literal("on").optional(),
});

export async function sendMessageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = sendSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the message.", { body: parsed.error.issues[0]?.message ?? "Invalid" });
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_message", { p_conversation_id: d.conversation_id, p_body: d.body, p_internal: d.portal === "admin" && d.internal === "on" });
  if (error) return fail(error.code === "22023" || error.code === "42501" ? error.message : dbErrorMessage(error, "The message could not be sent."));
  revalidatePath(`/${d.portal}/messages/${d.conversation_id}`);
  revalidatePath(`/${d.portal}/messages`);
  return success(d.internal ? "Internal note added." : "Message sent.");
}
