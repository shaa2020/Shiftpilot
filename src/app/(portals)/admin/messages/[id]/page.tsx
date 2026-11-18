import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadThread } from "@/lib/messages/data";
import { ThreadView } from "@/components/messages/thread-view";

export const metadata: Metadata = { title: "Conversation" };

export default async function AdminThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("shifts.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const thread = await loadThread(id);
  if (!thread || thread.conversation.agency_id !== ctx.agencyId) notFound();
  const supabase = await createClient();
  const c = thread.conversation;
  const [{ data: w }, { data: cl }] = await Promise.all([
    c.worker_id ? supabase.from("workers").select("first_name, last_name, display_name").eq("id", c.worker_id).maybeSingle() : Promise.resolve({ data: null }),
    c.client_id ? supabase.from("clients").select("name").eq("id", c.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const party = w ? `${w.display_name ?? `${w.first_name} ${w.last_name}`} · Worker` : cl ? `${cl.name} · Client` : undefined;
  return <ThreadView thread={thread} me={ctx.user.id} portal="admin" title={c.subject ?? "Conversation"} subtitle={party} />;
}
