import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { ListFilters } from "@/components/ui/list-filters";

export const metadata: Metadata = { title: "Staffing requests" };
const STATUSES = ["submitted", "under_review", "accepted", "rejected", "cancelled"];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireStaff("requests.read");
  const { status } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("shift_requests")
    .select("id, status, headcount, starts_at, ends_at, is_urgent, recurrence, submitted_at, created_at, clients(name), client_locations(name), job_positions(name)")
    .eq("agency_id", ctx.agencyId)
    .neq("status", "draft")
    .order("is_urgent", { ascending: false })
    .order("starts_at")
    .limit(300);
  q = status && STATUSES.includes(status) ? q.eq("status", status as "submitted") : q.in("status", ["submitted", "under_review"]);
  const { data: rows, error } = await q;
  if (error) throw error;
  return (
    <>
      <PageHeader title="Staffing requests" description="Requests submitted by clients. Accepting a request creates the shifts." />
      <ListFilters selects={[{ name: "status", label: "Status", value: status, options: STATUSES.map((s) => [s, humanize(s)]) }]} showSearch={false} />
      <Card className="overflow-hidden">
        {!rows?.length ? <EmptyState icon={Inbox} title="No requests waiting" className="m-5" /> : (
          <Table>
            <THead><tr><TH>When</TH><TH>Client · location</TH><TH>Position</TH><TH>Workers</TH><TH>Received</TH><TH>Status</TH></tr></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap"><Link href={`/admin/requests/${r.id}`} className="font-medium text-primary hover:underline">{formatDate(r.starts_at)}</Link><p className="text-xs text-muted-foreground">{formatTime(r.starts_at)}–{formatTime(r.ends_at)}{r.recurrence ? " · recurring" : ""}</p></TD>
                  <TD>{r.clients?.name}<p className="text-xs text-muted-foreground">{r.client_locations?.name}</p></TD>
                  <TD>{r.job_positions?.name}</TD>
                  <TD className="tabular-nums">{r.headcount}</TD>
                  <TD className="text-muted-foreground">{formatDateTime(r.submitted_at ?? r.created_at)}</TD>
                  <TD className="space-x-1">{r.is_urgent && <Badge tone="danger">Urgent</Badge>}<StatusBadge status={r.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
