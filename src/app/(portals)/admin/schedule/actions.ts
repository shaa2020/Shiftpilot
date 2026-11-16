"use server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  display?: "background";
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  startRecur?: string;
  endRecur?: string;
  color?: string;
  editable?: boolean;
  extendedProps: { kind: "shift" | "availability"; status?: string; client?: string; location?: string; filled?: number; headcount?: number };
}

const COLORS: Record<string, string> = {
  draft: "#94A3B8", open: "#D97706", offered: "#2563EB", partially_filled: "#D97706", filled: "#16A34A", in_progress: "#0891B2",
  completed: "#475569", awaiting_approval: "#7C3AED", approved: "#475569", invoiced: "#334155", cancelled: "#DC2626",
};

const filterSchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  client: z.string().uuid().optional().or(z.literal("")),
  location: z.string().uuid().optional().or(z.literal("")),
  position: z.string().uuid().optional().or(z.literal("")),
  worker: z.string().uuid().optional().or(z.literal("")),
  unfilled: z.boolean().optional(),
});

/** Calendar data source (called by FullCalendar for each visible range). */
export async function getScheduleEvents(input: z.infer<typeof filterSchema>): Promise<CalendarEvent[]> {
  const ctx = await requireStaff("shifts.read");
  const f = filterSchema.parse(input);
  const supabase = await createClient();
  const editable = ctx.can("shifts.write");
  const events: CalendarEvent[] = [];

  let shiftIds: string[] | null = null;
  if (f.worker) {
    const { data } = await supabase.from("shift_assignments").select("shift_id").eq("worker_id", f.worker).not("status", "in", "(declined,cancelled,replaced)");
    shiftIds = (data ?? []).map((r) => r.shift_id);
  }
  if (f.position) {
    const { data } = await supabase.from("shift_positions").select("shift_id").eq("position_id", f.position);
    const ids = (data ?? []).map((r) => r.shift_id);
    shiftIds = shiftIds ? shiftIds.filter((x) => ids.includes(x)) : ids;
  }
  let q = supabase
    .from("shifts")
    .select("id, title, starts_at, ends_at, status, clients(name), client_locations(name), shift_positions(headcount, filled_count)")
    .eq("agency_id", ctx.agencyId)
    .gte("ends_at", f.start)
    .lt("starts_at", f.end)
    .limit(2000);
  if (f.client) q = q.eq("client_id", f.client);
  if (f.location) q = q.eq("location_id", f.location);
  if (f.unfilled) q = q.in("status", ["open", "offered", "partially_filled"]);
  if (shiftIds) q = q.in("id", shiftIds.length ? shiftIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: shifts } = await q;
  for (const s of shifts ?? []) {
    const head = s.shift_positions.reduce((a, p) => a + p.headcount, 0);
    const filled = s.shift_positions.reduce((a, p) => a + p.filled_count, 0);
    events.push({
      id: s.id,
      title: `${s.title} (${filled}/${head}) · ${s.clients?.name ?? ""}`,
      start: s.starts_at,
      end: s.ends_at,
      color: COLORS[s.status] ?? "#64748B",
      editable: editable && ["draft", "open", "offered", "partially_filled", "filled"].includes(s.status),
      extendedProps: { kind: "shift", status: s.status, client: s.clients?.name, location: s.client_locations?.name, filled, headcount: head },
    });
  }

  if (f.worker) {
    const { data: avail } = await supabase.from("worker_availability").select("*").eq("worker_id", f.worker);
    for (const a of avail ?? []) {
      if (a.kind === "recurring") {
        events.push({ id: `av-${a.id}`, title: "Available", start: f.start, end: f.end, display: "background", color: "#86EFAC", daysOfWeek: [a.day_of_week! % 7], startTime: a.start_time!, endTime: a.end_time!, extendedProps: { kind: "availability" } });
      } else {
        events.push({
          id: `av-${a.id}`, title: a.kind === "available" ? "Available" : "Unavailable", display: "background",
          start: `${a.date_from}T${a.start_time ?? "00:00"}`, end: a.end_time ? `${a.date_to}T${a.end_time}` : `${a.date_to}T23:59`,
          color: a.kind === "available" ? "#86EFAC" : "#FCA5A5", extendedProps: { kind: "availability" },
        });
      }
    }
  }
  return events;
}
