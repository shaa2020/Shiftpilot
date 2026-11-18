/** Display helpers for documents (unit tested). Dates are YYYY-MM-DD strings. */
export type DocTone = "neutral" | "info" | "success" | "warning" | "danger";

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function addDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * One status a person understands, from the document's verification status,
 * whether a file exists and its expiry date.
 */
export function documentState(
  d: { status: string | null; current_version: number | null; expires_on: string | null; requested?: boolean } | null,
  today: string,
  soonDays = 30,
): { label: string; tone: DocTone; key: "missing" | "requested" | "review" | "verified" | "rejected" | "expired" | "expiring" } {
  if (!d || !d.current_version) return d?.requested ? { label: "Requested", tone: "warning", key: "requested" } : { label: "Missing", tone: "neutral", key: "missing" };
  if (d.expires_on && d.expires_on < today) return { label: "Expired", tone: "danger", key: "expired" };
  if (d.status === "rejected") return { label: "Rejected — upload again", tone: "danger", key: "rejected" };
  if (d.status === "verified") {
    if (d.expires_on && d.expires_on <= addDays(today, soonDays)) return { label: "Expires soon", tone: "warning", key: "expiring" };
    return { label: "Verified", tone: "success", key: "verified" };
  }
  if (d.status === "expired") return { label: "Expired", tone: "danger", key: "expired" };
  return { label: "Waiting for review", tone: "info", key: "review" };
}

export const REQUEST_STATUS: Record<string, { label: string; tone: DocTone }> = {
  open: { label: "Waiting for upload", tone: "warning" },
  submitted: { label: "Uploaded — to review", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Days until a due date (negative when overdue). */
export function daysUntil(date: string, today: string) {
  return Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86_400_000);
}

export function dueLabel(due: string | null, today: string): { label: string; overdue: boolean } | null {
  if (!due) return null;
  const n = daysUntil(due, today);
  if (n < 0) return { label: `Overdue by ${-n} day${n === -1 ? "" : "s"}`, overdue: true };
  if (n === 0) return { label: "Due today", overdue: false };
  if (n === 1) return { label: "Due tomorrow", overdue: false };
  return { label: `Due in ${n} days`, overdue: false };
}
