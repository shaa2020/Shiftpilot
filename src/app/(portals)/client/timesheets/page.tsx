import type { Metadata } from "next";
import { ClipboardCheck, WifiOff } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatTime } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ServerForm } from "@/components/forms/server-form";
import { DateTile } from "@/components/worker/shift-ui";
import { Avatar } from "@/components/client/fill";
import { bulkApproveTimesheetsAction, reviewTimesheetAction } from "../actions";

export const metadata: Metadata = { title: "Timesheets" };

export default async function ClientTimesheetsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireClient();
  const { view = "pending" } = await searchParams;
  const pending = view === "pending";
  const supabase = await createClient();
  let q = supabase
    .from("timesheets")
    .select("id, status, scheduled_start, scheduled_end, scheduled_break_minutes, actual_start, actual_end, break_minutes, worked_minutes, overtime_minutes, late_minutes, early_departure_minutes, has_offline_events, shifts(title), client_locations(name)")
    .eq("client_id", ctx.clientId)
    .order("scheduled_start", { ascending: false })
    .limit(300);
  q = pending ? q.eq("status", "submitted") : q.neq("status", "submitted");
  const { data } = await q;
  const { data: names } = data?.length ? await supabase.rpc("client_timesheet_workers", { p_timesheet_ids: data.map((t) => t.id) }) : { data: [] };
  const workerName = new Map((names ?? []).map((n) => [n.timesheet_id, n.worker_display_name]));
  const rows = data ?? [];
  const totalMin = rows.reduce((n, t) => n + (t.worked_minutes ?? 0), 0);
  const canApprove = pending && ctx.capabilities.approve;

  const list = (
    <ul className="space-y-2">
      {rows.map((t) => {
        const name = workerName.get(t.id) ?? "Worker";
        return (
          <li key={t.id} className="rounded-xl border border-border bg-surface p-3.5 shadow-[var(--shadow-card)]">
            <div className="flex gap-3">
              {canApprove ? (
                <input type="checkbox" name="ids" value={t.id} defaultChecked className="mt-1 size-5 shrink-0 accent-primary" aria-label={`Select ${name}`} />
              ) : null}
              <DateTile iso={t.scheduled_start} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar name={name} className="size-7 text-[11px]" />
                  <p className="font-semibold">{name}</p>
                  <span className="ml-auto"><StatusBadge status={t.status} /></span>
                </div>
                <p className="truncate text-sm text-muted-foreground">{t.shifts?.title} · {t.client_locations?.name}</p>
                <dl className="grid grid-cols-3 gap-2 rounded-lg bg-surface-muted p-2 text-center text-xs">
                  <div><dt className="text-muted-foreground">Planned</dt><dd className="font-medium tabular-nums">{formatTime(t.scheduled_start)}–{formatTime(t.scheduled_end)}</dd></div>
                  <div><dt className="text-muted-foreground">Recorded</dt><dd className="font-medium tabular-nums">{t.actual_start ? formatTime(t.actual_start) : "—"}–{t.actual_end ? formatTime(t.actual_end) : "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Worked</dt><dd className="font-semibold tabular-nums">{hoursLabel(t.worked_minutes ?? 0)} h</dd></div>
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>Break {t.break_minutes} min</Badge>
                  {t.late_minutes > 0 && <Badge tone="warning">{t.late_minutes} min late</Badge>}
                  {t.early_departure_minutes > 0 && <Badge tone="warning">Left {t.early_departure_minutes} min early</Badge>}
                  {t.overtime_minutes > 0 && <Badge tone="info">{hoursLabel(t.overtime_minutes)} overtime</Badge>}
                  {t.has_offline_events && <Badge><WifiOff className="size-3" aria-hidden /> Offline / manual entry</Badge>}
                </div>
                {canApprove && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <ConfirmAction action={reviewTimesheetAction} fields={{ id: t.id, approve: "true" }} title={`Approve ${hoursLabel(t.worked_minutes ?? 0)} h for ${name}?`} description="Approved hours are invoiced." confirmLabel="Approve" variant="default">Approve</ConfirmAction>
                    <ConfirmAction action={reviewTimesheetAction} fields={{ id: t.id, approve: "false" }} title="Dispute these hours?" description="The agency checks it with the worker and corrects the timesheet." withReason="What is incorrect?" variant="ghost" destructive confirmLabel="Send dispute">Dispute</ConfirmAction>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <PageHeader title="Timesheets" description="Check the recorded hours. Approved hours are invoiced; disputes go to the agency." />
      <SectionTabs tabs={[{ key: "pending", label: "To approve", href: "?view=pending" }, { key: "history", label: "History", href: "?view=history" }]} active={pending ? "pending" : "history"} />
      {!rows.length ? <EmptyState icon={ClipboardCheck} title={pending ? "Nothing to approve" : "No timesheets yet"} description={pending ? "You are notified when workers finish a shift." : undefined} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]"><p className="text-xs text-muted-foreground">{pending ? "Waiting for you" : "Shown"}</p><p className="text-xl font-semibold">{rows.length} timesheet{rows.length === 1 ? "" : "s"}</p></div>
            <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]"><p className="text-xs text-muted-foreground">Hours</p><p className="text-xl font-semibold tabular-nums">{hoursLabel(totalMin)}</p></div>
          </div>
          {canApprove ? (
            <ServerForm action={bulkApproveTimesheetsAction} submitLabel="Approve selected" pendingLabel="Approving…" footerClassName="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 justify-end lg:bottom-4">
              <p className="text-sm text-muted-foreground">All are selected. Untick any you want to check first, or approve and dispute one by one.</p>
              {list}
            </ServerForm>
          ) : list}
        </>
      )}
    </>
  );
}
