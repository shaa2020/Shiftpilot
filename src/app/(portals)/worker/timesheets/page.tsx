import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Timesheets" };

export default async function WorkerTimesheets() {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const { data } = await supabase
    .from("timesheets")
    .select("id, assignment_id, status, scheduled_start, actual_start, actual_end, worked_minutes, has_offline_events, shifts(title)")
    .eq("worker_id", ctx.workerId)
    .order("scheduled_start", { ascending: false })
    .limit(200);
  return (
    <>
      <PageHeader title="Timesheets" description="Hours you worked and their approval status." />
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={ClipboardCheck} title="No timesheets yet" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Date</TH><TH>Shift</TH><TH>Time</TH><TH>Hours</TH><TH>Status</TH></tr></THead>
            <TBody>
              {data.map((t) => (
                <TR key={t.id}>
                  <TD className="whitespace-nowrap">{formatDate(t.scheduled_start)}</TD>
                  <TD><Link href={`/worker/shifts/${t.assignment_id}`} className="text-primary hover:underline">{t.shifts?.title}</Link></TD>
                  <TD className="text-muted-foreground">{t.actual_start ? formatTime(t.actual_start) : "—"}–{t.actual_end ? formatTime(t.actual_end) : "—"}</TD>
                  <TD className="tabular-nums">{hoursLabel(t.worked_minutes ?? 0)}</TD>
                  <TD><StatusBadge status={t.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
