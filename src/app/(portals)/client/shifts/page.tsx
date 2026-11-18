import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatTime, nowMs } from "@/lib/time";
import { dayHeading, durationLabel, groupByDay, minutesBetween } from "@/lib/shift-format";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { DateTile } from "@/components/worker/shift-ui";
import { FillBar } from "@/components/client/fill";

export const metadata: Metadata = { title: "Shifts" };

export default async function ClientShiftsPage({ searchParams }: { searchParams: Promise<{ view?: string; location?: string }> }) {
  const ctx = await requireClient();
  const { view = "upcoming", location } = await searchParams;
  const past = view === "past";
  const supabase = await createClient();
  const now = nowMs();
  const nowIso = new Date(now).toISOString();
  let q = supabase.from("shifts").select("id, title, starts_at, ends_at, status, location_id, client_locations(name), shift_positions(headcount, filled_count, job_positions(name))").eq("client_id", ctx.clientId);
  if (location && /^[0-9a-f-]{36}$/.test(location)) q = q.eq("location_id", location);
  q = past ? q.lt("ends_at", nowIso).order("starts_at", { ascending: false }).limit(150) : q.gte("ends_at", nowIso).order("starts_at").limit(150);
  const [{ data }, { data: locations }] = await Promise.all([q, supabase.from("client_locations").select("id, name").eq("client_id", ctx.clientId).order("name")]);
  const groups = groupByDay(data ?? [], (s) => s.starts_at);
  const loc = location ? `&location=${location}` : "";

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Every shift at your locations with how many workers are confirmed."
        actions={ctx.capabilities.request && <Button asChild><Link href="/client/requests/new">Request staff</Link></Button>}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTabs tabs={[{ key: "upcoming", label: "Upcoming", href: `?view=upcoming${loc}` }, { key: "past", label: "Past", href: `?view=past${loc}` }]} active={past ? "past" : "upcoming"} />
        {(locations?.length ?? 0) > 1 && (
          <form method="get" className="mb-6 flex gap-2">
            <input type="hidden" name="view" value={view} />
            <NativeSelect name="location" defaultValue={location ?? ""} aria-label="Location" className="w-52">
              <option value="">All locations</option>
              {locations!.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
            <Button type="submit" variant="secondary">Filter</Button>
          </form>
        )}
      </div>
      {!groups.length ? <EmptyState icon={CalendarDays} title={past ? "No past shifts" : "No upcoming shifts"} /> : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.day} aria-label={dayHeading(g.first, new Date(now))}>
              <h2 className="mb-2 px-1 text-sm font-semibold">{dayHeading(g.first, new Date(now))}</h2>
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {g.items.map((s) => {
                  const total = s.shift_positions.reduce((n, p) => n + p.headcount, 0);
                  const filled = s.shift_positions.reduce((n, p) => n + p.filled_count, 0);
                  return (
                    <li key={s.id}>
                      <Link href={`/client/shifts/${s.id}`} className="flex h-full gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-[var(--shadow-card)] transition-colors hover:border-primary/50">
                        <DateTile iso={s.starts_at} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start gap-2"><p className="line-clamp-2 min-w-0 flex-1 font-semibold">{s.title}</p><StatusBadge status={s.status} /></div>
                          <p className="truncate text-sm text-muted-foreground">{s.shift_positions.map((p) => p.job_positions?.name).filter(Boolean).join(" · ")}</p>
                          <p className="flex items-center gap-1.5 text-sm"><Clock className="size-3.5 text-muted-foreground" aria-hidden /><span className="tabular-nums">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span><span className="text-muted-foreground">· {durationLabel(minutesBetween(s.starts_at, s.ends_at))}</span></p>
                          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground"><MapPin className="size-3.5" aria-hidden />{s.client_locations?.name}</p>
                          {s.status !== "cancelled" && <FillBar filled={filled} total={total} className="pt-1" />}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
