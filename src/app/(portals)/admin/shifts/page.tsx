import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Download, Plus } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatDate, localDate, formatTime, zonedMidnight } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect } from "@/components/ui/input";

export const metadata: Metadata = { title: "Shifts" };
const STATUSES = ["draft", "open", "offered", "partially_filled", "filled", "in_progress", "completed", "awaiting_approval", "approved", "invoiced", "cancelled"];

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; status?: string; client?: string; created?: string; unfilled?: string }> }) {
  const ctx = await requireStaff("shifts.read");
  const sp = await searchParams;
  const today = localDate(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : addDays(from, 14);
  const supabase = await createClient();
  let q = supabase
    .from("shifts")
    .select("id, title, starts_at, ends_at, status, clients(name), client_locations(name), shift_positions(headcount, filled_count)")
    .eq("agency_id", ctx.agencyId)
    .gte("starts_at", zonedMidnight(from).toISOString())
    .lt("starts_at", zonedMidnight(addDays(to, 1)).toISOString())
    .order("starts_at")
    .limit(500);
  if (sp.status && STATUSES.includes(sp.status)) q = q.eq("status", sp.status as "open");
  if (sp.unfilled) q = q.in("status", ["open", "offered", "partially_filled"]);
  if (sp.client && /^[0-9a-f-]{36}$/.test(sp.client)) q = q.eq("client_id", sp.client);
  const [{ data: shifts, error }, { data: clients }] = await Promise.all([
    q,
    supabase.from("clients").select("id, name").eq("agency_id", ctx.agencyId).neq("status", "archived").order("name"),
  ]);
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Shifts"
        description="All shifts with fill status. Open a shift to match and assign workers."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary"><a href={`/api/exports/shifts?from=${from}&to=${to}`} download><Download /> CSV</a></Button>
            <Button asChild variant="secondary"><Link href="/admin/schedule"><CalendarDays /> Calendar</Link></Button>
            {ctx.can("shifts.write") && <Button asChild><Link href="/admin/shifts/new"><Plus /> New shift</Link></Button>}
          </div>
        }
      />
      {sp.created && <Alert tone="success" className="mb-4">{sp.created} shifts created in the series.</Alert>}
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-5">
        <Input type="date" name="from" defaultValue={from} aria-label="From" />
        <Input type="date" name="to" defaultValue={to} aria-label="To" />
        <NativeSelect name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</NativeSelect>
        <NativeSelect name="client" defaultValue={sp.client ?? ""} aria-label="Client"><option value="">All clients</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <Card className="overflow-hidden">
        {!shifts?.length ? <EmptyState icon={CalendarDays} title="No shifts in this period" className="m-5" /> : (
          <Table>
            <THead><tr><TH>When</TH><TH>Shift</TH><TH>Client · location</TH><TH>Filled</TH><TH>Status</TH></tr></THead>
            <TBody>
              {shifts.map((s) => {
                const head = s.shift_positions.reduce((a, p) => a + p.headcount, 0);
                const filled = s.shift_positions.reduce((a, p) => a + p.filled_count, 0);
                return (
                  <TR key={s.id}>
                    <TD className="whitespace-nowrap"><p>{formatDate(s.starts_at)}</p><p className="text-xs text-muted-foreground">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</p></TD>
                    <TD><Link href={`/admin/shifts/${s.id}`} className="font-medium text-primary hover:underline">{s.title}</Link></TD>
                    <TD className="text-muted-foreground">{s.clients?.name} · {s.client_locations?.name}</TD>
                    <TD className={filled < head && s.status !== "cancelled" ? "font-medium text-warning tabular-nums" : "tabular-nums"}>{filled}/{head}</TD>
                    <TD><StatusBadge status={s.status} /></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
