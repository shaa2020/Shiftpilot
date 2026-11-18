import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { dayHeading, durationLabel, groupByDay, shiftLength, startsIn } from "@/lib/shift-format";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { SectionTabs } from "@/components/ui/detail";
import { ShiftCard } from "@/components/worker/shift-ui";
import { CalendarCard } from "./calendar-card";

export const metadata: Metadata = { title: "My schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireWorker();
  const { view = "upcoming" } = await searchParams;
  const history = view === "history";
  const supabase = await createClient();
  const now = new Date().toISOString();
  const nowNum = nowMs();
  let q = supabase
    .from("shift_assignments")
    .select("id, status, starts_at, ends_at, shifts(title, break_minutes, clients(name), client_locations(name, city)), shift_positions(job_positions(name))")
    .eq("worker_id", ctx.workerId);
  q = history
    ? q.or(`ends_at.lt.${now},status.in.(cancelled,declined,replaced,no_show,completed)`).order("starts_at", { ascending: false }).limit(100)
    : q.gte("ends_at", now).in("status", ["accepted", "confirmed", "checked_in", "replacement_requested"]).order("starts_at");
  const [{ data }, { data: feed }] = await Promise.all([q, supabase.from("calendar_feeds").select("last_used_at").eq("user_id", ctx.user.id).maybeSingle()]);
  const rows = data ?? [];
  const groups = groupByDay(rows, (r) => r.starts_at);
  const week = rows.filter((r) => new Date(r.starts_at).getTime() - nowNum < 7 * 86_400_000);
  const weekPaid = week.reduce((n, r) => n + shiftLength(r.starts_at, r.ends_at, r.shifts?.break_minutes ?? 0).paid, 0);

  return (
    <>
      <PageHeader title="My schedule" description={history ? "Shifts you worked, missed or that were cancelled." : "Your accepted and confirmed shifts."} />
      <SectionTabs tabs={[{ key: "upcoming", label: "Upcoming", href: "?view=upcoming" }, { key: "history", label: "History", href: "?view=history" }]} active={history ? "history" : "upcoming"} />
      {!history && rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
            <p className="text-xs text-muted-foreground">Next 7 days</p>
            <p className="text-lg font-semibold">{week.length} shift{week.length === 1 ? "" : "s"}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
            <p className="text-xs text-muted-foreground">Planned paid time</p>
            <p className="text-lg font-semibold">{durationLabel(weekPaid)}</p>
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={history ? "No past shifts" : "No upcoming shifts"}
          description={history ? undefined : "Accepted shifts appear here. New offers are under Offers."}
          action={history ? undefined : <Button asChild size="sm" variant="soft"><Link href="/worker/offers">See offers</Link></Button>}
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const paid = g.items.reduce((n, r) => n + shiftLength(r.starts_at, r.ends_at, r.shifts?.break_minutes ?? 0).paid, 0);
            return (
              <section key={g.day} aria-label={dayHeading(g.first, new Date(nowNum))}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold">{dayHeading(g.first, new Date(nowNum))}</h2>
                  {!history && <span className="text-xs text-muted-foreground">{durationLabel(paid)} paid</span>}
                </div>
                <ul className="space-y-2">
                  {g.items.map((a) => {
                    const when = startsIn(a.starts_at, a.ends_at, nowNum);
                    return (
                      <li key={a.id}>
                        <ShiftCard
                          s={{
                            href: `/worker/shifts/${a.id}`,
                            title: a.shifts?.title ?? "Shift",
                            starts_at: a.starts_at,
                            ends_at: a.ends_at,
                            break_minutes: a.shifts?.break_minutes,
                            position: a.shift_positions?.job_positions?.name,
                            client: a.shifts?.clients?.name,
                            location: a.shifts?.client_locations?.name,
                            city: a.shifts?.client_locations?.city,
                            status: a.status,
                            chip: !history && new Date(a.starts_at).getTime() - nowNum < 24 * 3600_000 ? when : null,
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {!history && <div className="mt-6"><CalendarCard active={!!feed} lastUsed={feed?.last_used_at ?? null} /></div>}
    </>
  );
}
