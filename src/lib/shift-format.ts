/** Display helpers for shifts in the worker app (unit tested). Times are shown in Europe/Amsterdam. */
const TZ = "Europe/Amsterdam";

/** Minutes between two instants. */
export function minutesBetween(start: string | Date, end: string | Date) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

/** "8h", "7h 30m", "45m". */
export function durationLabel(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Scheduled length and paid length (after the unpaid break). */
export function shiftLength(start: string, end: string, breakMinutes = 0) {
  const total = minutesBetween(start, end);
  return { total, paid: Math.max(0, total - (breakMinutes ?? 0)) };
}

/** Local calendar date (YYYY-MM-DD) in the agency time zone. */
export function localDay(iso: string | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

/** Parts for a calendar-style date tile. */
export function dateTile(iso: string) {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).format(d);
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

/** "Today", "Tomorrow", "Yesterday" or "Monday 23 November". */
export function dayHeading(iso: string, now: Date = new Date()) {
  const day = localDay(iso);
  const today = localDay(now);
  const diff = Math.round((Date.parse(day + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

/** "Starts in 2h 15m", "In progress", "Finished", "Starts in 3 days". */
export function startsIn(start: string, end: string, now: number = Date.now()) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (now >= e) return { label: "Finished", tone: "neutral" as const };
  if (now >= s) return { label: "In progress", tone: "success" as const };
  const mins = Math.round((s - now) / 60000);
  if (mins < 60) return { label: `Starts in ${mins}m`, tone: "warning" as const };
  if (mins < 24 * 60) return { label: `Starts in ${durationLabel(mins - (mins % 5))}`, tone: mins < 180 ? ("warning" as const) : ("info" as const) };
  const days = Math.round(mins / (24 * 60));
  return { label: `Starts in ${days} day${days === 1 ? "" : "s"}`, tone: "info" as const };
}

/** "Respond within 5h" for invitation expiry, or null when there is none / it passed. */
export function expiresIn(expires: string | null | undefined, now: number = Date.now()) {
  if (!expires) return null;
  const mins = Math.round((new Date(expires).getTime() - now) / 60000);
  if (mins <= 0) return null;
  return mins < 24 * 60 ? `Respond within ${durationLabel(mins)}` : `Respond within ${Math.round(mins / 1440)} days`;
}

/** Groups items by local day, keeping the input order. */
export function groupByDay<T>(items: T[], at: (t: T) => string): { day: string; first: string; items: T[] }[] {
  const out: { day: string; first: string; items: T[] }[] = [];
  for (const it of items) {
    const day = localDay(at(it));
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, first: at(it), items: [it] });
  }
  return out;
}

/** What a status means for the worker, in plain words. */
export const STATUS_HELP: Record<string, string> = {
  invited: "The agency offered you this shift. Accept or decline it under Offers.",
  accepted: "You accepted. The agency still has to confirm it.",
  confirmed: "Confirmed. You can check in from 2 hours before the start.",
  checked_in: "You are checked in. Check out when you finish.",
  checked_out: "You checked out. Your timesheet goes to the client for approval.",
  completed: "Completed and processed.",
  replacement_requested: "You reported you cannot work. The agency is arranging a replacement.",
  cancelled: "This shift was cancelled.",
  declined: "You declined this shift.",
  no_show: "Recorded as not attended. Contact the agency if this is wrong.",
  replaced: "Someone else took over this shift.",
  disputed: "The hours are being reviewed.",
};
