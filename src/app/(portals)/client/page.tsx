import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarDays, ClipboardCheck, Inbox, MapPin, MessageSquare, Plus, Receipt, UserCheck, Users, type LucideIcon } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatTime, localDate, nowMs } from "@/lib/time";
import { dayHeading } from "@/lib/shift-format";
import { getBranding } from "@/lib/branding";
import { unreadCount } from "@/lib/messages/data";
import { EmptyState, StatCard } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PortalFeed } from "@/components/engagement/portal-feed";
import { DateTile } from "@/components/worker/shift-ui";
import { Avatar, FillBar } from "@/components/client/fill";

export const metadata: Metadata = { title: "Overview" };

function Action({ href, icon: Icon, label, primary }: { href: string; icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <Button asChild variant={primary ? "default" : "secondary"} className="h-auto flex-col gap-1.5 py-3 sm:flex-row sm:py-2">
      <Link href={href}><Icon aria-hidden /> {label}</Link>
    </Button>
  );
}

export default async function ClientOverview() {
  const ctx = await requireClient();
  const supabase = await createClient();
  const now = nowMs();
  const nowIso = new Date(now).toISOString();
  const today = localDate(new Date(now));
  const in48h = new Date(now + 48 * 3600_000).toISOString();
  // All queries run under RLS: only this client's data at permitted locations is visible.
  const [upcoming, openRequests, pendingTimesheets, invoices, onDuty, brand, unread] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, title, starts_at, ends_at, status, client_locations(name), shift_positions(headcount, filled_count)")
      .eq("client_id", ctx.clientId).gte("ends_at", nowIso).neq("status", "cancelled").order("starts_at").limit(6),
    supabase.from("shift_requests").select("id", { count: "exact", head: true }).eq("client_id", ctx.clientId).in("status", ["submitted", "under_review"]),
    supabase.from("timesheets").select("id", { count: "exact", head: true }).eq("client_id", ctx.clientId).eq("status", "submitted"),
    ctx.capabilities.finance
      ? supabase.from("invoices").select("id, invoice_number, kind, total, amount_paid, due_date, status").eq("client_id", ctx.clientId).neq("status", "draft").order("issue_date", { ascending: false }).limit(5)
      : Promise.resolve({ data: null }),
    supabase.rpc("client_on_duty", { p_client_id: ctx.clientId }),
    getBranding(ctx.agencyId),
    unreadCount(ctx.agencyId),
  ]);
  const shifts = upcoming.data ?? [];
  const sum = (s: (typeof shifts)[number], k: "headcount" | "filled_count") => s.shift_positions.reduce((n, p) => n + p[k], 0);
  const gaps = shifts.filter((s) => s.starts_at < in48h && sum(s, "filled_count") < sum(s, "headcount"));
  const overdue = (invoices.data ?? []).filter((i) => i.kind === "invoice" && ["issued", "partially_paid"].includes(i.status) && i.due_date && i.due_date < today);
  const toApprove = pendingTimesheets.count ?? 0;
  const here = onDuty.data ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{ctx.clientName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome{ctx.user.fullName ? `, ${ctx.user.fullName.split(" ")[0]}` : ""}</h1>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        {ctx.capabilities.request && <Action href="/client/requests/new" icon={Plus} label="Request staff" primary />}
        {ctx.capabilities.approve && <Action href="/client/timesheets" icon={ClipboardCheck} label="Approve hours" />}
        <Action href="/client/messages" icon={MessageSquare} label={unread ? `Messages (${unread})` : "Messages"} />
      </div>

      {(toApprove > 0 && ctx.capabilities.approve) || gaps.length > 0 || overdue.length > 0 ? (
        <section className="mb-5 space-y-2" aria-label="Needs your attention">
          {toApprove > 0 && ctx.capabilities.approve && (
            <Link href="/client/timesheets" className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
              <ClipboardCheck className="size-5 shrink-0" aria-hidden />
              <span className="flex-1"><span className="font-semibold">{toApprove} timesheet{toApprove === 1 ? "" : "s"}</span> waiting for your approval</span>
              <span className="font-medium underline">Review</span>
            </Link>
          )}
          {gaps.length > 0 && (
            <Link href={`/client/shifts/${gaps[0]!.id}`} className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft/50 p-3 text-sm text-primary-soft-foreground">
              <AlertTriangle className="size-5 shrink-0" aria-hidden />
              <span className="flex-1"><span className="font-semibold">{gaps.length} shift{gaps.length === 1 ? "" : "s"} in the next 48 hours</span> not fully staffed yet — the agency is working on it</span>
            </Link>
          )}
          {overdue.length > 0 && (
            <Link href="/client/invoices" className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground">
              <Receipt className="size-5 shrink-0" aria-hidden />
              <span className="flex-1"><span className="font-semibold">{overdue.length} invoice{overdue.length === 1 ? " is" : "s are"} overdue</span></span>
              <span className="font-medium underline">View</span>
            </Link>
          )}
        </section>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/client/shifts"><StatCard label="Upcoming shifts" value={shifts.length >= 6 ? "6+" : shifts.length} icon={CalendarDays} tone="info" /></Link>
        <Link href="/client/shifts"><StatCard label="On site now" value={here.length} icon={UserCheck} tone={here.length ? "success" : "neutral"} /></Link>
        <Link href="/client/requests"><StatCard label="Open requests" value={openRequests.count ?? 0} icon={Inbox} /></Link>
        <Link href="/client/timesheets"><StatCard label="Hours to approve" value={toApprove} icon={ClipboardCheck} tone={toApprove && ctx.capabilities.approve ? "warning" : "neutral"} /></Link>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Upcoming shifts</CardTitle><Link href="/client/shifts" className="text-sm text-primary">All shifts</Link></CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No upcoming shifts" description="Request staff and the agency schedules the shifts here." action={ctx.capabilities.request ? <Button asChild size="sm" variant="soft"><Link href="/client/requests/new">Request staff</Link></Button> : undefined} />
            ) : (
              <ul className="space-y-2">
                {shifts.map((s) => (
                  <li key={s.id}>
                    <Link href={`/client/shifts/${s.id}`} className="flex gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/50">
                      <DateTile iso={s.starts_at} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start gap-2"><p className="min-w-0 flex-1 truncate font-medium">{s.title}</p><StatusBadge status={s.status} /></div>
                        <p className="text-sm text-muted-foreground">{dayHeading(s.starts_at, new Date(now))} · <span className="tabular-nums">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span></p>
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3" aria-hidden />{s.client_locations?.name}</p>
                        <FillBar filled={sum(s, "filled_count")} total={sum(s, "headcount")} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4" aria-hidden /> On site now</CardTitle></CardHeader>
            <CardContent>
              {here.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is checked in at the moment.</p> : (
                <ul className="space-y-2.5">
                  {here.map((w, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <Avatar name={w.worker_display_name} className="size-9 text-xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{w.worker_display_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{w.shift_title} · {w.location_name}</p>
                      </div>
                      <Badge tone="success">since {formatTime(w.checked_in_at)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {invoices.data && (
            <Card>
              <CardHeader className="flex-row items-center justify-between"><CardTitle>Recent invoices</CardTitle><Link href="/client/invoices" className="text-sm text-primary">All invoices</Link></CardHeader>
              <CardContent>
                {invoices.data.length === 0 ? <p className="text-sm text-muted-foreground">No invoices yet.</p> : (
                  <ul className="divide-y divide-border">
                    {invoices.data.map((i) => (
                      <li key={i.id} className="flex items-center gap-2 py-2.5 text-sm">
                        <a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-medium hover:underline">{i.invoice_number}</a>
                        <span className="tabular-nums">{formatMoney(Number(i.total))}</span>
                        <StatusBadge status={i.due_date && i.due_date < today && ["issued", "partially_paid"].includes(i.status) ? "overdue" : i.status} />
                      </li>
                    ))}
                  </ul>
                )}
                {overdue[0]?.due_date && <p className="mt-2 text-xs text-danger">Oldest overdue since {formatDate(overdue[0].due_date)}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="mt-6"><PortalFeed agencyId={ctx.agencyId} welcome={brand.clientWelcome} agencyName={brand.agencyName} /></div>
    </div>
  );
}
