import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, fold } from "./ics";

describe("ICS feed", () => {
  it("escapes text and folds long lines", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const folded = fold("DESCRIPTION:" + "x".repeat(200));
    expect(folded.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "x".repeat(200));
  });

  it("writes UTC events with CRLF line endings", () => {
    const ics = buildIcs("My shifts", [
      { uid: "a1@shiftpilot", start: "2026-12-01T07:00:00Z", end: "2026-12-01T15:30:00Z", summary: "Bediening, Hotel", location: "Damrak 1, Amsterdam", updated: "2026-11-18T10:00:00Z" },
    ]);
    expect(ics).toContain("DTSTART:20261201T070000Z\r\n");
    expect(ics).toContain("DTEND:20261201T153000Z\r\n");
    expect(ics).toContain("SUMMARY:Bediening\\, Hotel\r\n");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
