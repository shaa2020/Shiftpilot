import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { ServerForm } from "@/components/forms/server-form";
import { bulkAgencyApproveAction } from "./actions";

export const metadata: Metadata = { title: "Timesheets" };
const VIEWS = { client_approved: "Ready for agency approval", submitted: "Waiting for client", disputed: "Disputed", agency_approved: "Approved", locked: "Invoiced / exported" } as const;

export default async function AdminTimesheetsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireStaff("timesheets.read");
  const { view: raw } = await searchParams;
  const view = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).includes(raw as keyof typeof VIEWS) ? (raw as keyof typeof VIEWS) : "client_approved";
  const supabase = await createClient();
  const [{ data }, { count: corrections }] = await Promise.all([
    supabase.from("timesheets")
      .select("id, status, scheduled_start, actual_start, actual_end, worked_minutes, overtime_minutes, late_minutes, has_offline_events, clients(name), shifts(title), workers(first_name, last_name, engagement_type)")
      .eq("agency_id", ctx.agencyId).eq("status", view).order("scheduled_start", { ascending: false }).limit(300),
    supabase.from("attendance_corrections").select("id", { count: "exact", head: true }).eq("agency_id", ctx.agencyId).eq("status", "pending"),
  ]);
  const canApprove = view === "client_approved" && ctx.can("timesheets.approve");
  const table = (
    <Table>
      <THead><tr>{canApprove && <TH><span className="sr-only">Select</span></TH>}<TH>Date</TH><TH>Worker</TH><TH>Client · shift</TH><TH>Recorded</TH><TH>Hours</TH><TH>Status</TH></tr></THead>
      <TBody>
        {(data ?? []).map((t) => (
          <TR key={t.id}>
            {canApprove && <TD><input type="checkbox" name="ids" value={t.id} aria-label="Select" className="size-4 accent-primary" /></TD>}
            <TD className="whitespace-nowrap"><Link href={`/admin/timesheets/${t.id}`} className="text-primary hover:underline">{formatDate(t.scheduled_start)}</Link></TD>
            <TD>{t.workers?.first_name} {t.workers?.last_name}<p className="text-xs text-muted-foreground">{humanize(t.workers?.engagement_type ?? "")}</p></TD>
            <TD>{t.clients?.name}<p className="text-xs text-muted-foreground">{t.shifts?.title}</p></TD>
            <TD className="whitespace-nowrap">{t.actual_start ? formatTime(t.actual_start) : "—"}–{t.actual_end ? formatTime(t.actual_end) : "—"}<div className="space-x-1">{t.late_minutes > 0 && <Badge tone="warning">late {t.late_minutes}m</Badge>}{t.has_offline_events && <Badge>offline/manual</Badge>}</div></TD>
            <TD className="tabular-nums">{hoursLabel(t.worked_minutes ?? 0)}{t.overtime_minutes > 0 && <span className="text-xs text-muted-foreground"> (+{hoursLabel(t.overtime_minutes)} OT)</span>}</TD>
            <TD><StatusBadge status={t.status} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
  return (
    <>
      <PageHeader title="Timesheets" description={`Client approval first, then agency approval. ${corrections ? `${corrections} correction request(s) pending.` : ""}`} />
      <SectionTabs tabs={Object.entries(VIEWS).map(([k, l]) => ({ key: k, label: l, href: `?view=${k}` }))} active={view} />
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={ClipboardCheck} title="Nothing here" className="m-5" /> : canApprove ? (
          <ServerForm action={bulkAgencyApproveAction} submitLabel="Approve selected" className="space-y-0" footerClassName="p-4">{table}</ServerForm>
        ) : table}
      </Card>
    </>
  );
}
