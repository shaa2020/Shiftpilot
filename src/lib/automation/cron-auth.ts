import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Constant-time comparison. */
export function isAuthorisedCron(header: string | null): boolean {
  const secret = serverEnv.cronSecret();
  if (!secret || secret.length < 16 || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
