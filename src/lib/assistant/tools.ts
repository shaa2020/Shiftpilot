import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { StaffContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDate, nowMs } from "@/lib/time";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Read-only tools for the operations assistant. Every query runs with the
 * signed-in user's Supabase session, so RLS and the database permission
 * checks decide what the assistant can see. There are no write tools: the
 * assistant cannot approve, assign, invoice or change anything.
 */
type Supa = Awaited<ReturnType<typeof createClient>>;
interface ToolDef {
  permission: Permission;
  tool: Anthropic.Tool;
  schema: z.ZodType;
  run: (input: never, ctx: StaffContext, db: Supa) => Promise<unknown>;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const days = (n: number) => localDate(new Date(nowMs() + n * 86400000));

const DEFS: Record<string, ToolDef> = {
  list_shifts: {
    permission: "shifts.read",
    tool: {
      name: "list_shifts",
      description: "List shifts in a date range with fill status (confirmed vs. required headcount). Use to find unfilled or at-risk shifts.",
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Start date YYYY-MM-DD (default today)" },
          to: { type: "string", description: "End date YYYY-MM-DD inclusive (default +7 days)" },
          only_unfilled: { type: "boolean", description: "Only shifts with open positions" },
        },
        additionalProperties: false,
      },
    },
    schema: z.object({ from: date.optional(), to: date.optional(), only_unfilled: z.boolean().optional() }),
    run: async (i: { from?: string; to?: string; only_unfilled?: boolean }, ctx, db) => {
      const { data, error } = await db
        .from("shifts")
        .select("id, title, starts_at, ends_at, status, clients(name), client_locations(name, city), shift_positions(headcount, job_positions(name), shift_assignments(status))")
        .eq("agency_id", ctx.agencyId)
        .gte("starts_at", `${i.from ?? days(0)}T00:00:00`)
        .lte("starts_at", `${i.to ?? days(7)}T23:59:59`)
        .not("status", "in", "(cancelled,draft)")
        .order("starts_at")
        .limit(150);
      if (error) throw error;
      const rows = (data ?? []).map((s) => {
        const positions = s.shift_positions.map((p) => {
          const filled = p.shift_assignments.filter((a) => ["confirmed", "checked_in", "checked_out", "completed"].includes(a.status)).length;
          return { position: p.job_positions?.name, required: p.headcount, filled };
        });
        return { id: s.id, title: s.title, starts_at: s.starts_at, ends_at: s.ends_at, status: s.status, client: s.clients?.name, location: s.client_locations?.name, positions, open: positions.reduce((n, p) => n + Math.max(0, p.required - p.filled), 0) };
      });
      return i.only_unfilled ? rows.filter((r) => r.open > 0) : rows;
    },
  },
  attendance_alerts: {
    permission: "attendance.read",
    tool: { name: "attendance_alerts", description: "Current attendance alerts: confirmed workers who have not checked in after the grace period.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
    schema: z.object({}),
    run: async (_i: object, ctx, db) => {
      const { data, error } = await db.rpc("attendance_alerts", { p_agency_id: ctx.agencyId });
      if (error) throw error;
      return data;
    },
  },
  pending_timesheets: {
    permission: "timesheets.read",
    tool: { name: "pending_timesheets", description: "Timesheets waiting for client or agency approval, or disputed.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
    schema: z.object({}),
    run: async (_i: object, ctx, db) => {
      const { data, error } = await db.from("timesheets").select("id, status, scheduled_start, worked_minutes, workers(first_name, last_name), clients(name)").eq("agency_id", ctx.agencyId).in("status", ["submitted", "client_approved", "disputed"]).order("scheduled_start").limit(200);
      if (error) throw error;
      return data;
    },
  },
  staffing_requests: {
    permission: "requests.read",
    tool: { name: "staffing_requests", description: "Open client staffing requests that still need to be converted into shifts.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
    schema: z.object({}),
    run: async (_i: object, ctx, db) => {
      const { data, error } = await db.from("shift_requests").select("id, status, starts_at, ends_at, headcount, is_urgent, instructions, clients(name), job_positions(name)").eq("agency_id", ctx.agencyId).in("status", ["submitted", "under_review"]).order("starts_at").limit(100);
      if (error) throw error;
      return data;
    },
  },
  eligible_workers: {
    permission: "shifts.assign",
    tool: {
      name: "eligible_workers",
      description: "Ranked eligible workers for a shift position, with the reasons from the eligibility engine. Get shift_position_id from list_shifts first.",
      input_schema: { type: "object", properties: { shift_position_id: { type: "string", description: "UUID of the shift position" } }, required: ["shift_position_id"], additionalProperties: false },
    },
    schema: z.object({ shift_position_id: z.string().uuid() }),
    run: async (i: { shift_position_id: string }, _ctx, db) => {
      const { data, error } = await db.rpc("find_eligible_workers", { p_shift_position_id: i.shift_position_id, p_include_ineligible: false, p_limit: 15 });
      if (error) throw error;
      return data;
    },
  },
  expiring_documents: {
    permission: "compliance.read",
    tool: { name: "expiring_documents", description: "Documents, certificates and qualifications expired or expiring within N days.", input_schema: { type: "object", properties: { within_days: { type: "integer", minimum: 1, maximum: 180 } }, additionalProperties: false } },
    schema: z.object({ within_days: z.number().int().min(1).max(180).optional() }),
    run: async (i: { within_days?: number }, ctx, db) => {
      const { data, error } = await db.from("document_expiries").select("source, title, worker_id, expires_on, status").eq("agency_id", ctx.agencyId).lte("expires_on", days(i.within_days ?? 30)).order("expires_on").limit(200);
      if (error) throw error;
      return data;
    },
  },
  financial_summary: {
    permission: "finance.read",
    tool: { name: "financial_summary", description: "Revenue, margin, outstanding and overdue amounts for a period.", input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"], additionalProperties: false } },
    schema: z.object({ from: date, to: date }),
    run: async (i: { from: string; to: string }, ctx, db) => {
      const { data, error } = await db.rpc("financial_summary", { p_agency_id: ctx.agencyId, p_from: i.from, p_to: i.to });
      if (error) throw error;
      return data;
    },
  },
};

export function toolsFor(ctx: StaffContext): Anthropic.Tool[] {
  return Object.values(DEFS).filter((d) => ctx.can(d.permission)).map((d) => d.tool);
}

/** Runs a tool call; errors become tool results (is_error) rather than exceptions. */
export async function runTool(name: string, input: unknown, ctx: StaffContext, db: Supa): Promise<{ content: string; isError: boolean }> {
  const def = DEFS[name];
  if (!def || !ctx.can(def.permission)) return { content: "This tool is not available to you.", isError: true };
  const parsed = def.schema.safeParse(input ?? {});
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((x) => x.message).join("; ")}`, isError: true };
  try {
    const out = await def.run(parsed.data as never, ctx, db);
    const json = JSON.stringify(out ?? null);
    return { content: json.length > 60_000 ? `${json.slice(0, 60_000)}… (truncated: narrow the query)` : json, isError: false };
  } catch (e) {
    const msg = (e as { message?: string }).message ?? "Query failed";
    return { content: `The query failed: ${msg}`, isError: true };
  }
}
