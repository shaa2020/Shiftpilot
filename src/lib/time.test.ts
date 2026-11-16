import { describe, expect, it } from "vitest";
import { dayRange, localDate, monthRange, tzOffsetMinutes, zonedMidnight, formatMoney } from "./time";

describe("time-zone helpers", () => {
  it("computes Amsterdam offsets across DST", () => {
    expect(tzOffsetMinutes(new Date("2027-01-15T12:00:00Z"), "Europe/Amsterdam")).toBe(60);
    expect(tzOffsetMinutes(new Date("2027-07-15T12:00:00Z"), "Europe/Amsterdam")).toBe(120);
  });

  it("finds local midnight in winter and summer", () => {
    expect(zonedMidnight("2027-01-15").toISOString()).toBe("2027-01-14T23:00:00.000Z");
    expect(zonedMidnight("2027-07-15").toISOString()).toBe("2027-07-14T22:00:00.000Z");
  });

  it("handles the DST transition days (23h and 25h days)", () => {
    const spring = dayRange(new Date("2027-03-28T10:00:00Z"));
    expect((spring.end.getTime() - spring.start.getTime()) / 3600000).toBe(23);
    const autumn = dayRange(new Date("2027-10-31T10:00:00Z"));
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3600000).toBe(25);
  });

  it("uses the local date, not the UTC date", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Amsterdam.
    expect(localDate(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("computes month ranges including December rollover", () => {
    const r = monthRange(new Date("2027-12-10T10:00:00Z"));
    expect(r.start.toISOString()).toBe("2027-11-30T23:00:00.000Z");
    expect(r.end.toISOString()).toBe("2027-12-31T23:00:00.000Z");
  });

  it("formats euros in Dutch notation", () => {
    expect(formatMoney(1234.5).replace(/\s/g, " ")).toBe("€ 1.234,50");
  });
});

import { shiftWindow, zonedDateTime, localTime } from "./time";

describe("shift windows", () => {
  it("converts local wall-clock times in winter and summer", () => {
    expect(zonedDateTime("2027-01-15", "08:00").toISOString()).toBe("2027-01-15T07:00:00.000Z");
    expect(zonedDateTime("2027-07-15", "08:00").toISOString()).toBe("2027-07-15T06:00:00.000Z");
  });
  it("rolls overnight shifts to the next day", () => {
    const w = shiftWindow("2027-01-15", "22:00", "06:00");
    expect(w.startsAt.toISOString()).toBe("2027-01-15T21:00:00.000Z");
    expect(w.endsAt.toISOString()).toBe("2027-01-16T05:00:00.000Z");
  });
  it("handles a night shift across the autumn DST change (9 real hours)", () => {
    const w = shiftWindow("2027-10-30", "22:00", "06:00");
    expect((w.endsAt.getTime() - w.startsAt.getTime()) / 3600000).toBe(9);
  });
  it("formats local times", () => {
    expect(localTime("2027-07-15T06:00:00Z")).toBe("08:00");
  });
});
