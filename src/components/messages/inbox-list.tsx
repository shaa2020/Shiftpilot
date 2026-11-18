import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/messages/data";

export function InboxList({ items, base, showParty, emptyText }: { items: ConversationSummary[]; base: string; showParty?: boolean; emptyText: string }) {
  if (items.length === 0) return <EmptyState icon={MessageSquare} title="No conversations yet" description={emptyText} />;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`${base}/${c.id}`} className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-surface-muted", c.unread && "bg-primary-soft/40")}>
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", c.unread ? "bg-primary" : "bg-transparent")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>
                  {showParty && c.party_name ? `${c.party_name}${c.subject ? " · " : ""}` : ""}
                  {c.subject ?? (showParty && c.party_name ? "" : "Conversation")}
                </p>
                {showParty && (c.worker_id ? <Badge>Worker</Badge> : c.client_id ? <Badge>Client</Badge> : null)}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{c.last_at ? formatDateTime(c.last_at) : ""}</span>
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {c.last_sender ? `${c.last_sender}: ` : ""}
                {c.last_body}
              </p>
            </div>
            {c.unread && <span className="sr-only">Unread</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
