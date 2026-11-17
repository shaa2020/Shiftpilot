/**
 * Minimal Sentry reporter (no SDK): posts events to the DSN's store endpoint.
 * Never sends cookies, headers, query strings or request bodies, so tokens and
 * personal data in URLs (e.g. invitation links) are not exported.
 */
export interface ParsedDsn { storeUrl: string; publicKey: string }

export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, "").split("/").pop();
    if (u.protocol !== "https:" || !u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = u.pathname.replace(/\/?\d+\/?$/, "");
    return { storeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/store/`, publicKey: decodeURIComponent(u.username) };
  } catch {
    return null;
  }
}

export interface ErrorContext { path: string; method: string; routePath?: string; routeType?: string; environment?: string; release?: string }

export function buildEvent(err: unknown, ctx: ErrorContext, eventId: string) {
  const e = err instanceof Error ? err : new Error(String(err));
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const frames = (e.stack ?? "").split("\n").slice(1, 30).map((l) => l.trim()).filter(Boolean).reverse().map((l) => ({ function: l.slice(0, 200) }));
  return {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: "next.onRequestError",
    environment: ctx.environment ?? "development",
    release: ctx.release,
    transaction: ctx.routePath ?? ctx.path.split("?")[0],
    tags: { method: ctx.method, route_type: ctx.routeType ?? "unknown", ...(digest ? { digest } : {}) },
    request: { url: ctx.path.split("?")[0], method: ctx.method },
    exception: { values: [{ type: e.name || "Error", value: e.message.slice(0, 2000), stacktrace: frames.length ? { frames } : undefined }] },
  };
}

export async function reportError(dsn: string | undefined, err: unknown, ctx: ErrorContext): Promise<boolean> {
  const parsed = parseDsn(dsn);
  if (!parsed) return false;
  const eventId = crypto.randomUUID().replace(/-/g, "");
  try {
    const res = await fetch(parsed.storeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=shiftpilot/1.0` },
      body: JSON.stringify(buildEvent(err, ctx, eventId)),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
