import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarDays, Clock, FileText, Inbox, MapPin, MessageSquare, Navigation, Receipt, type LucideIcon } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatTime, nowMs } from "@/lib/time";
import { getAttendancePolicy, getWorkedMinutes, hoursLabel } from "@/lib/data/worker";
import { getBranding } from "@/lib/branding";
import { unreadCount } from "@/lib/messages/data";
import { directionsUrl } from "@/lib/maps";
import { dayHeading, durationLabel, shiftLength, startsIn } from "@/lib/shift-format";
import { EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { AttendanceControls } from "@/components/worker/attendance-controls";
import { DateTile, ShiftCard } from "@/components/worker/shift-ui";
import { PortalFeed } from "@/components/engagement/portal-feed";

export const metadata: Metadata = { title: "Home" };

function greeting(now: number) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function QuickLink({ href, icon: Icon, label, count }: { href: string; icon: LucideIcon; label: string; count?: number }) {
  return (
    <Link href={href} className="relative flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface p-3 text-center text-xs font-medium shadow-[var(--shadow-card)] transition-colors hover:border-primary/50 active:scale-[0.98]">
      <span className="grid size-9 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground"><Icon className="size-[18px]" aria-hidden /></span>
      {label}
      {!!count && <span className="absolute right-2 top-2 min-w-5 rounded-full bg-danger px-1.5 text-[11px] leading-5 text-white">{count}<span className="sr-only"> new</span></span>}
    </Link>
  );
}

export default async function WorkerHome() {
  const ctx = await requireWorker();
  const now = nowMs();
  const supabase = await createClient();
  const nowIso = new Date(now).toISOString();
  const [next, invitations, assigned, tasks, policy, hours, brand, unread, docReq] = await Promise.all([
    supabase
      .from("shift_assignments")
      .select("id, status, starts_at, ends_at, shifts(title, break_minutes, dress_code, clients(name), client_locations(name, address_line1, postal_code, city, latitude, longitude)), shift_positions(job_positions(name)), break_records(id, ended_at)")
      .eq("worker_id", ctx.workerId)
      .in("status", ["accepted", "confirmed", "checked_in"])
      .gte("ends_at", nowIso)
      .order("starts_at")
      .limit(4),
    supabase.from("shift_invitations").select("id", { count: "exact", head: true }).eq("worker_id", ctx.workerId).eq("status", "pending"),
    supabase.from("shift_assignments").select("id", { count: "exact", head: true }).eq("worker_id", ctx.workerId).eq("status", "invited"),
    supabase.from("onboarding_tasks").select("id, title, status, is_required, staff_only").eq("worker_id", ctx.workerId).in("status", ["pending", "blocked"]).order("sort_order"),
    getAttendancePolicy(ctx.workerId),
    getWorkedMinutes(ctx.workerId),
    getBranding(ctx.agencyId),
    unreadCount(ctx.agencyId),
    supabase.from("document_requests").select("id", { count: "exact", head: true }).eq("worker_id", ctx.workerId).eq("status", "open"),
  ]);
  const [nextShift, ...later] = next.data ?? [];
  const loc = nextShift?.shifts?.client_locations;
  const breakOpen = !!nextShift?.break_records.some((b) => !b.ended_at);
  const offers = (invitations.count ?? 0) + (assigned.count ?? 0);
  const startsSoon = nextShift && new Date(nextShift.starts_at).getTime() - now < 2 * 3600_000;
  const when = nextShift ? startsIn(nextShift.starts_at, nextShift.ends_at, now) : null;
  const len = nextShift ? shiftLength(nextShift.starts_at, nextShift.ends_at, nextShift.shifts?.break_minutes ?? 0) : null;
  const todo = (tasks.data ?? []).filter((t) => !t.staff_only);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting(now)}, {ctx.user.fullName?.split(" ")[0] ?? "there"}</h1>
      </div>

      {ctx.status !== "active" && (
        <Alert tone="info" title="Your onboarding is in progress" className="mb-4">
          Complete your <Link href="/worker/profile" className="underline">profile tasks</Link>. You can receive shift offers once the agency has finished its checks.
        </Alert>
      )}

      {offers > 0 && (
        <Link href="/worker/offers" className="mb-4 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          <Inbox className="size-5 shrink-0" aria-hidden />
          <span className="flex-1"><span className="font-semibold">{offers} new shift offer{offers === 1 ? "" : "s"}</span> waiting for your answer</span>
          <span className="font-medium underline">Respond</span>
        </Link>
      )}

      {!!docReq.count && (
        <Link href="/worker/documents" className="mb-4 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft/60 p-3 text-sm text-primary-soft-foreground">
          <FileText className="size-5 shrink-0" aria-hidden />
          <span className="flex-1"><span className="font-semibold">{docReq.count} document{docReq.count === 1 ? "" : "s"} requested</span> by your agency</span>
          <span className="font-medium underline">Upload</span>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40" aria-hidden />
          <CardHeader className="pb-2"><CardTitle className="text-base text-muted-foreground">Next shift</CardTitle></CardHeader>
          <CardContent>
            {nextShift && len && when ? (
              <div className="space-y-4">
                <Link href={`/worker/shifts/${nextShift.id}`} className="flex gap-4">
                  <DateTile iso={nextShift.starts_at} className="w-16" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={when.tone}>{when.label}</Badge>
                      <StatusBadge status={nextShift.status} />
                    </div>
                    <p className="mt-1 truncate text-lg font-semibold">{nextShift.shifts?.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{[nextShift.shift_positions?.job_positions?.name, nextShift.shifts?.clients?.name].filter(Boolean).join(" · ")}</p>
                  </div>
                </Link>
                <div className="space-y-1.5 text-sm">
                  <p className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" aria-hidden /><span className="tabular-nums">{dayHeading(nextShift.starts_at, new Date(now))}, {formatTime(nextShift.starts_at)}–{formatTime(nextShift.ends_at)}</span><span className="text-muted-foreground">· {durationLabel(len.total)}</span></p>
                  {loc && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><span>{loc.name}, {loc.address_line1}, {loc.city}</span></p>}
                </div>
                {nextShift.status === "accepted" && <p className="text-sm text-muted-foreground">Waiting for the agency to confirm this shift.</p>}
                {(nextShift.status === "checked_in" || (nextShift.status === "confirmed" && startsSoon)) && (
                  <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
                    <AttendanceControls assignmentId={nextShift.id} status={nextShift.status} breakOpen={breakOpen}
                      locationEnabled={policy.location_verification_enabled} privacyNotice={policy.location_privacy_notice} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {loc && <Button asChild variant="secondary"><a href={directionsUrl(loc)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> Directions</a></Button>}
                  <Button asChild className={loc ? "" : "col-span-2"}><Link href={`/worker/shifts/${nextShift.id}`}>Shift details</Link></Button>
                </div>
              </div>
            ) : (
              <EmptyState icon={CalendarDays} title="No upcoming shifts" description="Accepted shifts appear here." action={<Button asChild size="sm" variant="soft"><Link href="/worker/offers?tab=open">Find open shifts</Link></Button>} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <QuickLink href="/worker/offers" icon={Inbox} label="Offers" count={offers} />
            <QuickLink href="/worker/schedule" icon={CalendarDays} label="Schedule" />
            <QuickLink href="/worker/messages" icon={MessageSquare} label="Messages" count={unread} />
            <QuickLink href="/worker/timesheets" icon={Clock} label="Hours" />
            <QuickLink href="/worker/earnings" icon={Receipt} label="Earnings" />
            <QuickLink href="/worker/profile?tab=availability" icon={CalendarClock} label="Availability" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
              <p className="text-xs text-muted-foreground">Worked this week</p>
              <p className="text-xl font-semibold tabular-nums">{hoursLabel(hours.week)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
              <p className="text-xs text-muted-foreground">Worked this month</p>
              <p className="text-xl font-semibold tabular-nums">{hoursLabel(hours.month)}</p>
            </div>
          </div>
          {todo.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">To do</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {todo.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" aria-hidden />{t.title}</span>
                      <Link href="/worker/profile" className="shrink-0 font-medium text-primary">Do it</Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {later.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Coming up</h2>
            <Link href="/worker/schedule" className="text-sm text-primary">All shifts</Link>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {later.map((a) => (
              <li key={a.id}>
                <ShiftCard s={{ href: `/worker/shifts/${a.id}`, title: a.shifts?.title ?? "Shift", starts_at: a.starts_at, ends_at: a.ends_at, break_minutes: a.shifts?.break_minutes, client: a.shifts?.clients?.name, location: a.shifts?.client_locations?.name, city: a.shifts?.client_locations?.city, status: a.status }} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        <PortalFeed agencyId={ctx.agencyId} welcome={brand.workerWelcome} agencyName={brand.agencyName} />
      </div>
    </div>
  );
}
