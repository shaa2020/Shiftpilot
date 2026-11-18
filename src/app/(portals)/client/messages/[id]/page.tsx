import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireClient } from "@/lib/auth/session";
import { loadThread } from "@/lib/messages/data";
import { ThreadView } from "@/components/messages/thread-view";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClient();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const thread = await loadThread(id);
  if (!thread || thread.conversation.agency_id !== ctx.agencyId) notFound();
  return <ThreadView thread={thread} me={ctx.user.id} portal="client" title={thread.conversation.subject ?? "Conversation"} subtitle="With your agency" />;
}
