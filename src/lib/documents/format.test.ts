import { describe, expect, it } from "vitest";
import { documentState, dueLabel, fileSize } from "./format";

describe("document display helpers", () => {
  const today = "2026-11-18";
  it("summarises the document state", () => {
    expect(documentState(null, today).key).toBe("missing");
    expect(documentState({ status: "pending", current_version: 0, expires_on: null, requested: true }, today).key).toBe("requested");
    expect(documentState({ status: "pending", current_version: 1, expires_on: null }, today).key).toBe("review");
    expect(documentState({ status: "verified", current_version: 2, expires_on: "2027-06-01" }, today).key).toBe("verified");
    expect(documentState({ status: "verified", current_version: 1, expires_on: "2026-12-01" }, today).key).toBe("expiring");
    expect(documentState({ status: "verified", current_version: 1, expires_on: "2026-11-01" }, today).key).toBe("expired");
    expect(documentState({ status: "rejected", current_version: 1, expires_on: null }, today).key).toBe("rejected");
  });
  it("labels due dates and sizes", () => {
    expect(dueLabel("2026-11-16", today)).toEqual({ label: "Overdue by 2 days", overdue: true });
    expect(dueLabel("2026-11-18", today)?.label).toBe("Due today");
    expect(dueLabel("2026-11-25", today)?.label).toBe("Due in 7 days");
    expect(dueLabel(null, today)).toBeNull();
    expect(fileSize(2_500_000)).toBe("2.4 MB");
    expect(fileSize(20_000)).toBe("20 KB");
  });
});
