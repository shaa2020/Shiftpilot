"use server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { rateLimit } from "@/lib/security/request";
import { runAssistant, type AssistantResult } from "@/lib/assistant/run";

const historySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000) })).min(1).max(30);

export async function askAssistantAction(history: unknown): Promise<AssistantResult> {
  const ctx = await requireStaff("dashboard.view");
  const parsed = historySchema.safeParse(history);
  if (!parsed.success || parsed.data.at(-1)?.role !== "user") return { ok: false, message: "Invalid conversation." };
  if (!(await rateLimit("assistant", ctx.user.id, 30, 3600))) return { ok: false, message: "You have reached the hourly assistant limit." };
  return runAssistant(ctx, parsed.data);
}
