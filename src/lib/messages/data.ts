import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ConversationSummary = {
  id: string; subject: string | null; worker_id: string | null; client_id: string | null; party_name: string | null;
  updated_at: string; last_body: string | null; last_sender: string | null; last_at: string | null; unread: boolean; is_participant: boolean;
};

/** The caller's conversations in an agency (RLS decides which). */
export const listConversations = cache(async (agencyId: string): Promise<ConversationSummary[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_conversations", { p_agency_id: agencyId });
  return (data ?? []) as ConversationSummary[];
});

export async function unreadCount(agencyId: string): Promise<number> {
  return (await listConversations(agencyId)).filter((c) => c.unread).length;
}

export async function loadThread(conversationId: string) {
  const supabase = await createClient();
  const [{ data: conversation }, { data: messages }, { data: senders }] = await Promise.all([
    supabase.from("conversations").select("id, agency_id, subject, worker_id, client_id, created_at").eq("id", conversationId).maybeSingle(),
    supabase.from("messages").select("id, sender_user_id, body, is_internal, created_at").eq("conversation_id", conversationId).order("created_at").limit(500),
    supabase.rpc("conversation_senders", { p_conversation_id: conversationId }),
  ]);
  if (!conversation) return null;
  const people = new Map((senders ?? []).map((s) => [s.user_id, s]));
  await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  return { conversation, messages: messages ?? [], people };
}
