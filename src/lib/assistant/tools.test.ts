import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { runTool, toolsFor } from "./tools";
import type { StaffContext } from "@/lib/auth/session";

const ctx = (perms: string[]) => ({ agencyId: "a", user: { id: "u" }, can: (p: string) => perms.includes(p) }) as unknown as StaffContext;

describe("assistant tools", () => {
  it("only offers tools the user is permitted to use, and none of them write", () => {
    expect(toolsFor(ctx([])).map((t) => t.name)).toEqual([]);
    const all = toolsFor(ctx(["shifts.read", "attendance.read", "timesheets.read", "requests.read", "shifts.assign", "compliance.read", "finance.read"])).map((t) => t.name);
    expect(all).toContain("list_shifts");
    expect(all.every((n) => !/approve|assign_worker|create|update|delete|issue/.test(n))).toBe(true);
  });

  it("refuses tools outside the user's permissions and invalid input without touching the database", async () => {
    const db = { rpc: vi.fn(), from: vi.fn() } as never;
    expect(await runTool("financial_summary", { from: "2026-01-01", to: "2026-01-31" }, ctx(["shifts.read"]), db)).toEqual({ content: "This tool is not available to you.", isError: true });
    expect((await runTool("eligible_workers", { shift_position_id: "not-a-uuid" }, ctx(["shifts.assign"]), db)).isError).toBe(true);
    expect((await runTool("drop_tables", {}, ctx(["shifts.read"]), db)).isError).toBe(true);
  });

  it("passes the agency scope and returns errors as tool results", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Not authorised" } });
    const res = await runTool("attendance_alerts", {}, ctx(["attendance.read"]), { rpc } as never);
    expect(rpc).toHaveBeenCalledWith("attendance_alerts", { p_agency_id: "a" });
    expect(res).toEqual({ content: "The query failed: Not authorised", isError: true });
  });
});
