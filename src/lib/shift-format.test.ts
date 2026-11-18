import { describe, expect, it } from "vitest";
import { dateTile, dayHeading, durationLabel, expiresIn, groupByDay, shiftLength, startsIn } from "./shift-format";

describe("shift display helpers", () => {
  it("formats durations and paid time", () => {
    expect(durationLabel(480)).toBe("8h");
    expect(durationLabel(450)).toBe("7h 30m");
    expect(durationLabel(45)).toBe("45m");
    expect(shiftLength("2026-12-01T07:00:00Z", "2026-12-01T15:30:00Z", 30)).toEqual({ total: 510, paid: 480 });
  });

  it("uses Amsterdam days for headings and tiles", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    expect(dayHeading("2026-12-01T22:30:00Z", now)).toBe("Today"); // 23:30 in Amsterdam
    expect(dayHeading("2026-12-01T23:30:00Z", now)).toBe("Tomorrow");
    expect(dayHeading("2026-12-01T12:00:00Z", now)).toBe("Today");
    expect(dateTile("2026-12-01T23:30:00Z")).toEqual({ weekday: "Wed", day: "2", month: "Dec" });
  });

  it("describes when a shift starts", () => {
    const now = Date.parse("2026-12-01T10:00:00Z");
    expect(startsIn("2026-12-01T10:30:00Z", "2026-12-01T18:00:00Z", now).label).toBe("Starts in 30m");
    expect(startsIn("2026-12-01T12:17:00Z", "2026-12-01T18:00:00Z", now).label).toBe("Starts in 2h 15m");
    expect(startsIn("2026-12-01T09:00:00Z", "2026-12-01T18:00:00Z", now).label).toBe("In progress");
    expect(startsIn("2026-12-04T10:00:00Z", "2026-12-04T18:00:00Z", now).label).toBe("Starts in 3 days");
    expect(expiresIn("2026-12-01T15:00:00Z", now)).toBe("Respond within 5h");
    expect(expiresIn("2026-12-01T09:00:00Z", now)).toBeNull();
  });

  it("groups by local day", () => {
    const g = groupByDay(["2026-12-01T08:00:00Z", "2026-12-01T22:59:00Z", "2026-12-01T23:30:00Z"], (s) => s);
    expect(g.map((x) => x.items.length)).toEqual([2, 1]);
  });
});
