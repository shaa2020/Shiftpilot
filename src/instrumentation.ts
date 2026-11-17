import type { Instrumentation } from "next";
import { reportError } from "@/lib/observability/error-report";

export function register() {}

/** Server errors → structured log, plus Sentry when SENTRY_DSN is set. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ level: "error", msg: "request_error", path: request.path.split("?")[0], method: request.method, route: context.routePath, type: context.routeType, error: message.slice(0, 500) }));
  await reportError(process.env.SENTRY_DSN, err, {
    path: request.path, method: request.method, routePath: context.routePath, routeType: context.routeType,
    environment: process.env.NEXT_PUBLIC_APP_ENV, release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
};
