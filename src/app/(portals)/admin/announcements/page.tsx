import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, nowMs } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field, CheckboxField } from "@/components/forms/field";
import { ServerForm } from "@/components/forms/server-form";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { endAnnouncementAction, publishAnnouncementAction, togglePinAction } from "./actions";

export const metadata: Metadata = { title: "Announcements" };

const AUDIENCE: Record<string, string> = { everyone: "Everyone", workers: "Workers", clients: "Clients", staff: "Staff" };

export default async function AnnouncementsPage() {
  const ctx = await requireStaff("notifications.manage");
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("id, title, body, audience, pinned, published_at, expires_at")
    .eq("agency_id", ctx.agencyId)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(100);
  const now = nowMs();
  const items = data ?? [];

  return (
    <>
      <PageHeader title="Announcements" description="Post news to workers, clients or your team. They see it on their home screen and get a notification." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-24 lg:self-start">
          <CardHeader>
            <CardTitle>New announcement</CardTitle>
            <CardDescription>Everyone in the audience is notified straight away.</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerForm action={publishAnnouncementAction} submitLabel="Publish" pendingLabel="Publishing…" resetOnSuccess>
              <Field name="title" label="Title" required>
                <Input name="title" maxLength={160} placeholder="New uniforms available" />
              </Field>
              <Field name="body" label="Message" required>
                <Textarea name="body" rows={5} maxLength={5000} />
              </Field>
              <Field name="audience" label="Audience" required>
                <NativeSelect name="audience" defaultValue="workers">
                  <option value="workers">Workers</option>
                  <option value="clients">Clients</option>
                  <option value="everyone">Everyone (workers, clients and staff)</option>
                  <option value="staff">Staff only</option>
                </NativeSelect>
              </Field>
              <Field name="expires_at" label="Show until" hint="Optional. Hidden automatically after this time.">
                <Input name="expires_at" type="datetime-local" />
              </Field>
              <CheckboxField name="pinned" label="Pin to the top" />
            </ServerForm>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {items.length === 0 ? (
            <EmptyState icon={Megaphone} title="No announcements yet" description="Your first announcement will appear here." />
          ) : (
            items.map((a) => {
              const expired = a.expires_at && new Date(a.expires_at).getTime() <= now;
              return (
                <Card key={a.id}>
                  <CardContent className="space-y-2 pt-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="mr-auto font-semibold">{a.title}</h2>
                      {a.pinned && <Badge tone="info">Pinned</Badge>}
                      <Badge>{AUDIENCE[a.audience] ?? a.audience}</Badge>
                      {expired && <Badge tone="warning">Ended</Badge>}
                    </div>
                    <p className="whitespace-pre-line text-sm text-foreground/90">{a.body}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <p className="mr-auto text-xs text-muted-foreground">
                        Published {formatDateTime(a.published_at)}
                        {a.expires_at && ` · ${expired ? "ended" : "until"} ${formatDateTime(a.expires_at)}`}
                      </p>
                      <ConfirmAction action={togglePinAction} fields={{ id: a.id }} title={a.pinned ? "Unpin this announcement?" : "Pin this announcement?"} confirmLabel={a.pinned ? "Unpin" : "Pin"} variant="ghost">
                        {a.pinned ? "Unpin" : "Pin"}
                      </ConfirmAction>
                      <ConfirmAction action={endAnnouncementAction} fields={{ id: a.id }} title="Remove this announcement?" description="It disappears from every portal. Notifications already sent stay in people's inboxes." confirmLabel="Remove" destructive variant="ghost">
                        Remove
                      </ConfirmAction>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
