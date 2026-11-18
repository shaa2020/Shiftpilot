import type { Metadata } from "next";
import { requireWorker } from "@/lib/auth/session";
import { listConversations } from "@/lib/messages/data";
import { startConversationAction } from "@/lib/messages/actions";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { ServerForm } from "@/components/forms/server-form";
import { InboxList } from "@/components/messages/inbox-list";
import { AutoRefresh } from "@/components/messages/auto-refresh";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const ctx = await requireWorker();
  const items = await listConversations(ctx.agencyId);
  return (
    <>
      <AutoRefresh ms={30000} />
      <PageHeader title="Messages" description="Questions about a shift, your hours or documents? Message the agency here." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <InboxList items={items} base="/worker/messages" emptyText="Conversations with your agency will appear here." />
        <Card className="lg:sticky lg:top-24 lg:self-start">
          <CardHeader>
            <CardTitle>Message the agency</CardTitle>
            <CardDescription>The planning team replies here and you get a notification.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerForm action={startConversationAction} submitLabel="Send" pendingLabel="Sending…">
              <input type="hidden" name="portal" value="worker" />
              <input type="hidden" name="agency_id" value={ctx.agencyId} />

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
