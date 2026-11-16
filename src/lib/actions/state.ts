import type { z } from "zod";

/** Result returned by every Server Action that backs a form. */
export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string | undefined>;
  /** Optional payload (e.g. a one-time invitation link). */
  data?: Record<string, string>;
}

export const initialState: ActionState = {};

/** FormData → plain object; repeated keys become arrays; empty strings kept. */
export function formObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const value = typeof v === "string" ? v : v;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], value);
    else out[k] = value;
  }
  return out;
}

export function zodErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string | null;
}

/**
 * Maps a database error to a message that is safe to show. Business-rule
 * errors raised by our triggers (P0001/P0002/42501) carry human-readable
 * messages; anything else is replaced by a generic message.
 */
export function dbErrorMessage(error: PgLikeError | null | undefined, fallback = "The change could not be saved."): string {
  if (!error) return fallback;
  if (error.code === "P0001" || error.code === "P0002") return error.message ?? fallback;
  if (error.code === "42501") return error.message?.includes("row-level security") ? "You are not allowed to make this change." : (error.message ?? fallback);
  if (error.code === "23505") return "A record with these details already exists.";
  if (error.code === "23503") return "This record is referenced elsewhere or refers to something that does not exist.";
  if (error.code === "23514") return "Some values are not allowed. Please check the form.";
  if (error.code === "23P01") return "This overlaps with an existing record.";
  return fallback;
}

export function fail(message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors };
}

export function success(message: string, data?: Record<string, string>): ActionState {
  return { ok: true, message, data };
}
