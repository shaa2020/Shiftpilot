import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Copy, Inbox, MapPin, Plus, Repeat, Users } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { DateTile } from "@/components/worker/shift-ui";
import { cancelRequestAction, submitDraftRequestAction } from "../actions";

export const metadata: Metadata = { title: "Staffing requests" };
const OPEN = ["draft", "submitted", "under_review"];
const STEPS = ["submitted", "under_review", "accepted"] as const;

export default async function ClientRequestsPage({ searchParams }: { searchParams: Promise<{ created?: string; view?: string }> }) {
  const ctx = await requireClient();
  const { created, view: rawView } = await searchParams;
  const view = rawView === "done" ? "done" : "open";
  const supabase = await createClient();
  const { data } = await supabase
    .from("shift_requests")
    .select("id, status, headcount, starts_at, ends_at, break_minutes, is_urgent, recurrence, rejection_reason, client_reference, created_at, client_locations(name), job_positions(name)")
    .eq("client_id", ctx.clientId)
    .order("starts_at", { ascending: view === "open" })
    .limit(200);
  const rows = (data ?? []).filter((r) => (view === "open" ? OPEN.includes(r.status) : !OPEN.includes(r.status)));

  return (
    <>
      <PageHeader title="Staffing requests" description="Ask the agency for workers. You are notified when the request is accepted and workers are confirmed."
        actions={ctx.capabilities.request && <Button asChild><Link href="/client/requests/new"><Plus /> Request staff</Link></Button>} />
      {created && <Alert tone="success" className="mb-4">Your request was sent. The agency reviews it and you get a notification when it is accepted.</Alert>}
      <SectionTabs tabs={[{ key: "open", label: "Open", href: "?view=open" }, { key: "done", label: "Handled", href: "?view=done" }]} active={view} />
      {!rows.length ? (
        <EmptyState icon={Inbox} title={view === "open" ? "No open requests" : "Nothing here yet"} action={ctx.capabilities.request && view === "open" ? <Button asChild size="sm" variant="soft"><Link href="/client/requests/new">Request staff</Link></Button> : undefined} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const stepIdx = STEPS.indexOf(r.status as (typeof STEPS)[number]);
            return (
              <li key={r.id} className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="flex gap-3">
                  <DateTile iso={r.starts_at} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="mr-auto font-semibold">{r.job_positions?.name}</p>
                      {r.is_urgent && <Badge tone="danger">Urgent</Badge>}
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="flex items-center gap-1.5 text-sm"><Clock className="size-3.5 text-muted-foreground" aria-hidden /><span className="tabular-nums">{formatTime(r.starts_at)}–{formatTime(r.ends_at)}</span></p>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="size-3.5" aria-hidden />{r.client_locations?.name}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" aria-hidden />{r.headcount} worker{r.headcount === 1 ? "" : "s"}</span>
                      {r.recurrence && <span className="inline-flex items-center gap-1.5"><Repeat className="size-3.5" aria-hidden />Weekly</span>}
                      {r.client_reference && <span>Ref {r.client_reference}</span>}
                    </p>
                  </div>
                </div>
                {stepIdx >= 0 && view === "open" && (
                  <ol className="mt-3 grid grid-cols-3 gap-1 text-[11px]" aria-label="Progress">
                    {["Sent", "In review", "Accepted"].map((l, i) => (
                      <li key={l} className="space-y-1">
                        <div className={i <= stepIdx ? "h-1 rounded-full bg-primary" : "h-1 rounded-full bg-surface-muted"} />
                        <span className={i <= stepIdx ? "font-medium" : "text-muted-foreground"}>{l}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {r.rejection_reason && <p className="mt-2 rounded-lg bg-danger-soft p-2 text-sm text-danger-soft-foreground">{r.rejection_reason}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <span className="mr-auto text-xs text-muted-foreground">Sent {formatDate(r.created_at)}</span>
                  {ctx.capabilities.request && r.status === "draft" && <ConfirmAction action={submitDraftRequestAction} fields={{ id: r.id }} title="Send this request to the agency?" variant="soft">Send</ConfirmAction>}
                  {ctx.capabilities.request && <Button asChild size="sm" variant="ghost"><Link href={`/client/requests/new?from=${r.id}`}><Copy aria-hidden /> Request again</Link></Button>}
                  {ctx.capabilities.request && ["draft", "submitted", "under_review", "accepted"].includes(r.status) && (
                    <ConfirmAction action={cancelRequestAction} fields={{ id: r.id }} title="Cancel this request?" description={r.status === "accepted" ? "Shifts already scheduled stay in place; the agency will contact you." : undefined} withReason="Reason" variant="ghost" destructive confirmLabel="Cancel request">Cancel</ConfirmAction>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
