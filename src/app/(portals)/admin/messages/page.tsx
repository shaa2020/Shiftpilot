import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listConversations } from "@/lib/messages/data";
import { startConversationAction } from "@/lib/messages/actions";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { ServerForm } from "@/components/forms/server-form";
import { InboxList } from "@/components/messages/inbox-list";
import { AutoRefresh } from "@/components/messages/auto-refresh";

export const metadata: Metadata = { title: "Messages" };

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const ctx = await requireStaff("shifts.read");
  const { to } = await searchParams;
  const supabase = await createClient();
  const [items, { data: workers }, { data: clients }] = await Promise.all([
    listConversations(ctx.agencyId),
    supabase.from("workers").select("id, first_name, last_name, display_name").eq("agency_id", ctx.agencyId).not("user_id", "is", null).neq("status", "archived").order("first_name").limit(1000),
    supabase.from("clients").select("id, name, client_memberships!inner(status)").eq("agency_id", ctx.agencyId).eq("client_memberships.status", "active").order("name").limit(1000),
  ]);
  const uniqueClients = [...new Map((clients ?? []).map((c) => [c.id, c])).values()];

  return (
    <>
      <AutoRefresh ms={30000} />
      <PageHeader title="Messages" description="Conversations with workers and clients. Threads waiting for a reply are highlighted." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <InboxList items={items} base="/admin/messages" showParty emptyText="Start a conversation with a worker or client, or wait for them to message you." />
        <Card className="lg:sticky lg:top-24 lg:self-start">
          <CardHeader>
            <CardTitle>New message</CardTitle>
            <CardDescription>Workers and clients need a portal account to receive messages.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerForm action={startConversationAction} submitLabel="Send" pendingLabel="Sending…">
              <input type="hidden" name="portal" value="admin" />
              <input type="hidden" name="agency_id" value={ctx.agencyId} />
              <Field name="recipient" label="To" required>
                <NativeSelect name="recipient" defaultValue={to ?? ""}>
                  <option value="">Choose…</option>
                  <optgroup label="Workers">
                    {(workers ?? []).map((w) => (
                      <option key={w.id} value={`worker:${w.id}`}>{w.display_name ?? `${w.first_name} ${w.last_name}`}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Clients (all portal users)">
                    {uniqueClients.map((c) => (
                      <option key={c.id} value={`client:${c.id}`}>{c.name}</option>
                    ))}
                  </optgroup>
                </NativeSelect>
              </Field>
              <Field name="subject" label="Subject">
                <Input name="subject" maxLength={160} />
              </Field>
              <Field name="body" label="Message" required>
                <Textarea name="body" rows={4} maxLength={5000} />
              </Field>
            </ServerForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
