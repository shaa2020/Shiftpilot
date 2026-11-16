import { Badge } from "./badge";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<string, Tone> = {
  active: "success", approved: "success", verified: "success", filled: "success", confirmed: "success", completed: "success",
  paid: "success", won: "success", hired: "success", accepted: "success", published: "success", agency_approved: "success",
  client_approved: "info", checked_in: "info", checked_out: "info", in_progress: "info", offered: "info", submitted: "info",
  under_review: "info", issued: "info", review: "info", interview: "info", screening: "info", assessment: "info", offer: "info",
  invited: "info", onboarding: "info", contacted: "info", qualified: "info", proposal: "info", negotiation: "info", new: "info",
  pending: "warning", pending_review: "warning", partially_filled: "warning", open: "warning", partially_paid: "warning",
  awaiting_approval: "warning", disputed: "warning", replacement_requested: "warning", on_hold: "warning", draft: "neutral",
  pending_signature: "warning", restricted: "warning", not_submitted: "neutral",
  rejected: "danger", cancelled: "danger", no_show: "danger", suspended: "danger", lost: "danger", declined: "danger",
  expired: "danger", terminated: "danger", overdue: "danger", withdrawn: "neutral", archived: "neutral", inactive: "neutral",
  closed: "neutral", locked: "neutral", invoiced: "neutral", replaced: "neutral", ended: "neutral", credited: "neutral",
};

export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{humanize(status)}</Badge>;
}
