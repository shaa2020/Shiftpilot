/** Time-zone aware helpers (agency default: Europe/Amsterdam). Pure and unit tested. */
export const DEFAULT_TZ = "Europe/Amsterdam";

/** Offset in minutes between UTC and `tz` at the given instant (e.g. +60 for CET). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(at: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** UTC instant of local midnight for a YYYY-MM-DD date in `tz` (DST-safe). */
export function zonedMidnight(date: string, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  let offset = tzOffsetMinutes(guess, tz);
  let result = new Date(guess.getTime() - offset * 60000);
  // Re-evaluate once in case midnight falls on the other side of a DST change.
  const offset2 = tzOffsetMinutes(result, tz);
  if (offset2 !== offset) {
    offset = offset2;
    result = new Date(guess.getTime() - offset * 60000);
  }
  return result;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** [start, end) of the local day containing `at`. */
export function dayRange(at: Date, tz: string = DEFAULT_TZ): { start: Date; end: Date } {
  const today = localDate(at, tz);
  return { start: zonedMidnight(today, tz), end: zonedMidnight(addDays(today, 1), tz) };
}

/** [start, end) of the local calendar month containing `at`. */
export function monthRange(at: Date, tz: string = DEFAULT_TZ): { start: Date; end: Date } {
  const [y, m] = localDate(at, tz).split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: zonedMidnight(first, tz), end: zonedMidnight(next, tz) };
}

export function formatDateTime(iso: string | Date, tz: string = DEFAULT_TZ, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function formatMoney(amount: number, currency = "EUR", locale = "nl-NL"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

/** UTC instant for a local wall-clock date + time in `tz` (DST-safe). */
export function zonedDateTime(date: string, time: string, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = tzOffsetMinutes(new Date(guess), tz);
  let result = new Date(guess - offset * 60000);
  const offset2 = tzOffsetMinutes(result, tz);
  if (offset2 !== offset) {
    offset = offset2;
    result = new Date(guess - offset * 60000);
  }
  return result;
}

/** Start/end of a shift from local date and times; an end at or before the start rolls to the next day. */
export function shiftWindow(date: string, start: string, end: string, tz: string = DEFAULT_TZ): { startsAt: Date; endsAt: Date } {
  const startsAt = zonedDateTime(date, start, tz);
  const endDate = end <= start ? addDays(date, 1) : date;
  return { startsAt, endsAt: zonedDateTime(endDate, end, tz) };
}

export function formatTime(iso: string | Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatDate(iso: string | Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** Local HH:MM of an instant. */
export function localTime(iso: string | Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
