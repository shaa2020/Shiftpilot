import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";

export const metadata: Metadata = { title: "Shifts" };

export default async function ClientShiftsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireClient();
  const { view = "upcoming" } = await searchParams;
  const supabase = await createClient();
  const now = new Date().toISOString();
  let q = supabase.from("shifts").select("id, title, starts_at, ends_at, status, client_locations(name), shift_positions(headcount, filled_count)").eq("client_id", ctx.clientId);
  q = view === "past" ? q.lt("ends_at", now).order("starts_at", { ascending: false }).limit(200) : q.gte("ends_at", now).order("starts_at").limit(200);
  const { data } = await q;
  return (
    <>
      <PageHeader title="Shifts" description="Shifts at your locations with the workers assigned." />
      <SectionTabs tabs={[{ key: "upcoming", label: "Upcoming", href: "?view=upcoming" }, { key: "past", label: "Past", href: "?view=past" }]} active={view === "past" ? "past" : "upcoming"} />
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={CalendarDays} title="No shifts" className="m-5" /> : (
          <Table>
            <THead><tr><TH>When</TH><TH>Shift</TH><TH>Location</TH><TH>Staffed</TH><TH>Status</TH></tr></THead>
            <TBody>
              {data.map((s) => (
                <TR key={s.id}>
                  <TD className="whitespace-nowrap">{formatDate(s.starts_at)}<p className="text-xs text-muted-foreground">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</p></TD>
                  <TD><Link href={`/client/shifts/${s.id}`} className="font-medium text-primary hover:underline">{s.title}</Link></TD>
                  <TD className="text-muted-foreground">{s.client_locations?.name}</TD>
                  <TD className="tabular-nums">{s.shift_positions.reduce((a, p) => a + p.filled_count, 0)}/{s.shift_positions.reduce((a, p) => a + p.headcount, 0)}</TD>
                  <TD><StatusBadge status={s.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
