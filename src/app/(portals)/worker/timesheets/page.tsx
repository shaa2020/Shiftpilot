import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ClipboardCheck, WifiOff } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatTime } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { SectionTabs } from "@/components/ui/detail";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateTile } from "@/components/worker/shift-ui";

export const metadata: Metadata = { title: "Timesheets" };

const WAITING = ["draft", "submitted", "client_approved", "disputed"];
const DONE = ["agency_approved", "locked"];

export default async function WorkerTimesheets({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireWorker();
  const { view: raw } = await searchParams;
  const view = raw === "approved" ? "approved" : raw === "all" ? "all" : "waiting";
  const supabase = await createClient();
  const { data } = await supabase
    .from("timesheets")
    .select("id, assignment_id, status, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, worked_minutes, has_offline_events, shifts(title, clients(name))")
    .eq("worker_id", ctx.workerId)
    .order("scheduled_start", { ascending: false })
    .limit(200);
  const all = data ?? [];
  const waiting = all.filter((t) => WAITING.includes(t.status));
  const approved = all.filter((t) => DONE.includes(t.status));
  const rows = view === "waiting" ? waiting : view === "approved" ? approved : all;
  const sum = (xs: typeof all) => xs.reduce((n, t) => n + (t.worked_minutes ?? 0), 0);

  return (
    <>
      <PageHeader title="Timesheets" description="Your recorded hours. The client approves first, then the agency. Open a shift to request a correction." />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
          <p className="text-xs text-muted-foreground">Waiting for approval</p>
          <p className="text-xl font-semibold tabular-nums">{hoursLabel(sum(waiting))}</p>
          <p className="text-xs text-muted-foreground">{waiting.length} shift{waiting.length === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
          <p className="text-xs text-muted-foreground">Approved</p>
          <p className="text-xl font-semibold tabular-nums">{hoursLabel(sum(approved))}</p>
          <p className="text-xs text-muted-foreground">{approved.length} shift{approved.length === 1 ? "" : "s"}</p>
        </div>
      </div>
      <SectionTabs
        tabs={[{ key: "waiting", label: "Waiting", href: "?view=waiting" }, { key: "approved", label: "Approved", href: "?view=approved" }, { key: "all", label: "All", href: "?view=all" }]}
        active={view}
      />
      {rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={view === "waiting" ? "Nothing waiting for approval" : "No timesheets yet"} description="Timesheets are created when you check in and out of a shift." />
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/worker/shifts/${t.assignment_id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-[var(--shadow-card)] transition-colors hover:border-primary/50">
                <DateTile iso={t.scheduled_start} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-start gap-2">
                    <p className="line-clamp-2 min-w-0 flex-1 font-semibold">{t.shifts?.title}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{t.shifts?.clients?.name}</p>
                  <p className="text-sm tabular-nums">
                    {t.actual_start ? formatTime(t.actual_start) : "—"}–{t.actual_end ? formatTime(t.actual_end) : "—"}
                    <span className="text-muted-foreground"> · break {t.break_minutes}m · </span>
                    <span className="font-semibold">{hoursLabel(t.worked_minutes ?? 0)} h</span>
                  </p>
                  {t.has_offline_events && <p className="flex items-center gap-1 text-xs text-warning"><WifiOff className="size-3" aria-hidden /> Includes times recorded offline</p>}
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
