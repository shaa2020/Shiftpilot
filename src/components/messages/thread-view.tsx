import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Field, CheckboxField } from "@/components/forms/field";
import { ServerForm } from "@/components/forms/server-form";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { sendMessageAction } from "@/lib/messages/actions";
import type { loadThread } from "@/lib/messages/data";
import { AutoRefresh } from "./auto-refresh";

type Thread = NonNullable<Awaited<ReturnType<typeof loadThread>>>;

export function ThreadView({ thread, me, portal, title, subtitle }: { thread: Thread; me: string; portal: "admin" | "worker" | "client"; title: string; subtitle?: string }) {
  const { conversation, messages, people } = thread;
  return (
    <div className="mx-auto max-w-3xl">
      <AutoRefresh soon />
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/${portal}/messages`} className="rounded-lg p-2 hover:bg-surface-muted" aria-label="Back to messages">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <Card>
        <CardContent className="space-y-3 pt-5">
          <ol className="space-y-3" aria-label="Messages">
            {messages.map((m) => {
              const mine = m.sender_user_id === me;
              const who = m.sender_user_id ? people.get(m.sender_user_id) : undefined;
              return (
                <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                      m.is_internal
                        ? "border border-dashed border-warning/60 bg-warning-soft text-warning-soft-foreground"
                        : mine
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md bg-surface-muted text-foreground",
                    )}
                  >
                    <p className={cn("mb-0.5 text-[11px] font-medium", mine && !m.is_internal ? "text-primary-foreground/80" : "text-muted-foreground")}>
                      {m.is_internal && <Lock className="mr-1 inline size-3" aria-label="Internal note" />}
                      {mine ? "You" : (who?.full_name ?? "Former user")}
                      {!mine && who?.is_staff && portal !== "admin" ? " · Agency" : ""} · {formatDateTime(m.created_at)}
                    </p>
                    <p className="whitespace-pre-line break-words">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-border pt-4">
            <ServerForm action={sendMessageAction} submitLabel="Send" pendingLabel="Sending…" resetOnSuccess toastOnSuccess={false}>
              <input type="hidden" name="portal" value={portal} />
              <input type="hidden" name="conversation_id" value={conversation.id} />
              <Field name="body" label="Reply">
                <Textarea name="body" rows={3} maxLength={5000} placeholder="Write a message…" />
              </Field>
              {portal === "admin" && <CheckboxField name="internal" label="Internal note" description="Only visible to your team." />}
            </ServerForm>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
