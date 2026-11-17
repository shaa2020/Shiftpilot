import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Bell } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { markReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireUser("/notifications");
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, title, body, link_path, read_at, created_at").order("created_at", { ascending: false }).limit(100);
  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/portal" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Back</Link>
      <PageHeader title="Notifications" description={`${unread} unread`} actions={unread > 0 && <ConfirmAction action={markReadAction} title="Mark all as read?" variant="secondary">Mark all read</ConfirmAction>} />
      <Card>
        {!data?.length ? <EmptyState icon={Bell} title="No notifications" className="m-5" /> : (
          <ul className="divide-y divide-border">
            {data.map((n) => (
              <li key={n.id} className={cn("flex items-start justify-between gap-3 p-4 text-sm", !n.read_at && "bg-primary-soft/30")}>
                <div>
                  <p className={cn(!n.read_at && "font-semibold")}>{n.link_path ? <Link href={n.link_path} className="hover:underline">{n.title}</Link> : n.title}</p>
                  {n.body && <p className="text-muted-foreground">{n.body}</p>}
                  <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
                </div>
                {!n.read_at && <ConfirmAction action={markReadAction} fields={{ id: n.id }} title="Mark as read?" variant="ghost">Read</ConfirmAction>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
