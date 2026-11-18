import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { reviewTimesheetAction } from "../actions";

export const metadata: Metadata = { title: "Timesheets" };

export default async function ClientTimesheetsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireClient();
  const { view = "pending" } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("timesheets")
    .select("id, status, scheduled_start, scheduled_end, scheduled_break_minutes, actual_start, actual_end, break_minutes, worked_minutes, overtime_minutes, late_minutes, has_offline_events, shifts(title), client_locations(name)")
    .eq("client_id", ctx.clientId)
    .order("scheduled_start", { ascending: false })
    .limit(300);
  q = view === "pending" ? q.eq("status", "submitted") : q.neq("status", "submitted");
  const { data } = await q;
  const { data: names } = data?.length ? await supabase.rpc("client_timesheet_workers", { p_timesheet_ids: data.map((t) => t.id) }) : { data: [] };
  const workerName = new Map((names ?? []).map((n) => [n.timesheet_id, n.worker_display_name]));
  return (
    <>
      <PageHeader title="Timesheets" description="Check the recorded hours. Approved hours are invoiced; disputes go to the agency." />
      <SectionTabs tabs={[{ key: "pending", label: "To approve", href: "?view=pending" }, { key: "history", label: "History", href: "?view=history" }]} active={view === "pending" ? "pending" : "history"} />
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={ClipboardCheck} title={view === "pending" ? "Nothing to approve" : "No timesheets yet"} className="m-5" /> : (
          <Table>
            <THead><tr><TH>Date</TH><TH>Worker · shift</TH><TH>Planned</TH><TH>Recorded</TH><TH>Hours</TH><TH>Status</TH>{view === "pending" && ctx.capabilities.approve && <TH className="text-right">Review</TH>}</tr></THead>
            <TBody>
              {data.map((t) => (
                <TR key={t.id}>
                  <TD className="whitespace-nowrap">{formatDate(t.scheduled_start)}</TD>
                  <TD><span className="font-medium">{workerName.get(t.id) ?? "—"}</span><p className="text-xs text-muted-foreground">{t.shifts?.title} · {t.client_locations?.name}</p></TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatTime(t.scheduled_start)}–{formatTime(t.scheduled_end)} ({t.scheduled_break_minutes}m)</TD>
                  <TD className="whitespace-nowrap">{t.actual_start ? formatTime(t.actual_start) : "—"}–{t.actual_end ? formatTime(t.actual_end) : "—"} ({t.break_minutes}m)
                    <div className="space-x-1">{t.late_minutes > 0 && <Badge tone="warning">{t.late_minutes} min late</Badge>}{t.has_offline_events && <Badge>Offline/manual entry</Badge>}</div></TD>
                  <TD className="tabular-nums">{hoursLabel(t.worked_minutes ?? 0)}{t.overtime_minutes > 0 && <p className="text-xs text-muted-foreground">incl. {hoursLabel(t.overtime_minutes)} overtime</p>}</TD>
                  <TD><StatusBadge status={t.status} /></TD>
                  {view === "pending" && ctx.capabilities.approve && (
                    <TD className="space-x-1 whitespace-nowrap text-right">
                      <ConfirmAction action={reviewTimesheetAction} fields={{ id: t.id, approve: "true" }} title="Approve these hours?" description="Approved hours are invoiced." confirmLabel="Approve" variant="default">Approve</ConfirmAction>
                      <ConfirmAction action={reviewTimesheetAction} fields={{ id: t.id, approve: "false" }} title="Dispute these hours?" withReason="What is incorrect?" variant="ghost" destructive confirmLabel="Send dispute">Dispute</ConfirmAction>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
