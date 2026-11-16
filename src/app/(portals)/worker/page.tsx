import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Clock, Inbox, MapPin, Navigation } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { nowMs } from "@/lib/time";
import { getAttendancePolicy, getWorkedMinutes, hoursLabel } from "@/lib/data/worker";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { AttendanceControls } from "@/components/worker/attendance-controls";
import { directionsUrl } from "@/lib/maps";

export const metadata: Metadata = { title: "Home" };

export default async function WorkerHome() {
  const ctx = await requireWorker();
  const now_ms = nowMs();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [next, invitations, assigned, tasks, policy, hours] = await Promise.all([
    supabase
      .from("shift_assignments")
      .select("id, status, starts_at, ends_at, shifts(title, dress_code, client_locations(name, address_line1, postal_code, city, latitude, longitude)), break_records(id, ended_at)")
      .eq("worker_id", ctx.workerId)
      .in("status", ["accepted", "confirmed", "checked_in"])
      .gte("ends_at", now)
      .order("starts_at")
      .limit(3),
    supabase.from("shift_invitations").select("id", { count: "exact", head: true }).eq("worker_id", ctx.workerId).eq("status", "pending"),
    supabase.from("shift_assignments").select("id", { count: "exact", head: true }).eq("worker_id", ctx.workerId).eq("status", "invited"),
    supabase.from("onboarding_tasks").select("id, title, status, is_required, staff_only").eq("worker_id", ctx.workerId).in("status", ["pending", "blocked"]).order("sort_order"),
    getAttendancePolicy(ctx.workerId),
    getWorkedMinutes(ctx.workerId),
  ]);
  const nextShift = next.data?.[0];
  const loc = nextShift?.shifts?.client_locations;
  const breakOpen = !!nextShift?.break_records.some((b) => !b.ended_at);
  const offers = (invitations.count ?? 0) + (assigned.count ?? 0);
  const startsSoon = nextShift && new Date(nextShift.starts_at).getTime() - now_ms < 2 * 3600_000;

  return (
    <>
      <PageHeader title={`Hi ${ctx.user.fullName?.split(" ")[0] ?? "there"}`} />
      {ctx.status !== "active" && (
        <Alert tone="info" title="Your onboarding is in progress" className="mb-4">
          Complete your <Link href="/worker/profile" className="underline">profile tasks</Link>. You can receive shift offers once the agency has finished its checks.
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="md:row-span-2">
          <CardHeader><CardTitle>Next shift</CardTitle></CardHeader>
          <CardContent>
            {nextShift ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-lg font-semibold">{nextShift.shifts?.title}</p>
                  <p className="flex items-center gap-1 text-muted-foreground"><Clock className="size-4" aria-hidden />{formatDate(nextShift.starts_at)} · {formatTime(nextShift.starts_at)}–{formatTime(nextShift.ends_at)}</p>
                  <p className="flex items-center gap-1 text-muted-foreground"><MapPin className="size-4" aria-hidden />{loc?.name}, {loc?.address_line1}, {loc?.city}</p>
                  {nextShift.shifts?.dress_code && <p className="text-muted-foreground">Dress code: {nextShift.shifts.dress_code}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={nextShift.status} />
                  {loc && <Button asChild size="sm" variant="secondary"><a href={directionsUrl(loc)} target="_blank" rel="noopener noreferrer"><Navigation /> Directions</a></Button>}
                  <Button asChild size="sm" variant="ghost"><Link href={`/worker/shifts/${nextShift.id}`}>Details</Link></Button>
                </div>
                {nextShift.status === "accepted" && <p className="text-muted-foreground">Waiting for the agency to confirm this shift.</p>}
                {(nextShift.status === "checked_in" || (nextShift.status === "confirmed" && startsSoon)) && (
                  <AttendanceControls assignmentId={nextShift.id} status={nextShift.status} breakOpen={breakOpen}
                    locationEnabled={policy.location_verification_enabled} privacyNotice={policy.location_privacy_notice} />
                )}
              </div>
            ) : (
              <EmptyState icon={CalendarDays} title="No upcoming shifts" description="Accepted shifts appear here." action={<Button asChild size="sm" variant="soft"><Link href="/worker/offers">Browse offers</Link></Button>} />
            )}
          </CardContent>
        </Card>
        <Link href="/worker/offers" className="block"><StatCard label="Open offers" value={offers} icon={Inbox} tone={offers ? "warning" : "neutral"} hint="Tap to respond" /></Link>
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Hours this week" value={hoursLabel(hours.week)} />
          <StatCard label="Hours this month" value={hoursLabel(hours.month)} />
        </div>
      </div>
      {tasks.data && tasks.data.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>To do</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {tasks.data.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <span>{t.title}</span>
                  <span className="text-xs text-muted-foreground">{t.staff_only ? "Agency" : <Link href="/worker/profile" className="text-primary">Do it</Link>}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
