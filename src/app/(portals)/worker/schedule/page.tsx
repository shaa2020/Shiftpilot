import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";
import { CalendarCard } from "./calendar-card";

export const metadata: Metadata = { title: "My schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireWorker();
  const { view = "upcoming" } = await searchParams;
  const supabase = await createClient();
  const now = new Date().toISOString();
  let q = supabase.from("shift_assignments").select("id, status, starts_at, ends_at, shifts(title, clients(name), client_locations(name, city))").eq("worker_id", ctx.workerId);
  q = view === "history"
    ? q.or(`ends_at.lt.${now},status.in.(cancelled,declined,replaced,no_show,completed)`).order("starts_at", { ascending: false }).limit(100)
    : q.gte("ends_at", now).in("status", ["accepted", "confirmed", "checked_in", "replacement_requested"]).order("starts_at");
  const [{ data }, { data: feed }] = await Promise.all([q, supabase.from("calendar_feeds").select("last_used_at").eq("user_id", ctx.user.id).maybeSingle()]);
  return (
    <>
      <PageHeader title="My schedule" />
      <CalendarCard active={!!feed} lastUsed={feed?.last_used_at ?? null} />
      <SectionTabs tabs={[{ key: "upcoming", label: "Upcoming", href: "?view=upcoming" }, { key: "history", label: "History", href: "?view=history" }]} active={view === "history" ? "history" : "upcoming"} />
      {!data?.length ? <EmptyState icon={CalendarDays} title={view === "history" ? "No past shifts" : "No upcoming shifts"} /> : (
        <ul className="space-y-2">
          {data.map((a) => (
            <li key={a.id}>
              <Link href={`/worker/shifts/${a.id}`}>
                <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-primary/50">
                  <div className="text-sm">
                    <p className="font-medium">{a.shifts?.title}</p>
                    <p className="text-muted-foreground">{formatDate(a.starts_at)} · {formatTime(a.starts_at)}–{formatTime(a.ends_at)}</p>
                    <p className="text-muted-foreground">{a.shifts?.clients?.name} · {a.shifts?.client_locations?.name}, {a.shifts?.client_locations?.city}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
