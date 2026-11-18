import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { acceptRequestAction, markUnderReviewAction, rejectRequestAction } from "../../shifts/actions";

export const metadata: Metadata = { title: "Staffing request" };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("requests.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("shift_requests").select("*, clients(id, name), client_locations(name, city), job_positions(name, allows_freelancers), profiles!shift_requests_requested_by_fkey(full_name, email)").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: skills }, { data: shifts }] = await Promise.all([
    r.required_skill_ids.length ? supabase.from("skills").select("name").in("id", r.required_skill_ids) : Promise.resolve({ data: [] as { name: string }[] }),
    supabase.from("shifts").select("id, starts_at, status").eq("shift_request_id", id).order("starts_at"),
  ]);
  const rec = r.recurrence as { days?: number[]; until?: string } | null;
  const open = r.status === "submitted" || r.status === "under_review";
  return (
    <>
      <Link href="/admin/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Requests</Link>
      <PageHeader
        title={`${r.headcount} × ${r.job_positions?.name}`}
        description={`${r.clients?.name} · ${r.client_locations?.name}`}
        actions={<div className="flex items-center gap-2">{r.is_urgent && <Badge tone="danger">Urgent</Badge>}<StatusBadge status={r.status} /></div>}
      />
      {r.status === "rejected" && <Alert tone="danger" title="Rejected" className="mb-4">{r.rejection_reason}</Alert>}
      {r.status === "cancelled" && <Alert tone="warning" title="Cancelled by the client" className="mb-4">{r.cancellation_reason}</Alert>}
      {open && ctx.can("requests.review") && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap gap-2 pt-5">
            {ctx.can("shifts.write") && (
              <ConfirmAction action={acceptRequestAction} fields={{ id }} title="Accept request and create shifts?" description={`Creates ${rec ? "a recurring series of shifts" : "the shift"} with ${r.headcount} open position(s). You then match and confirm workers.`} withReason="Shift title (optional — defaults to the position name)" confirmLabel="Accept" variant="default">
                Accept & create shifts
              </ConfirmAction>
            )}
            {r.status === "submitted" && <ConfirmAction action={markUnderReviewAction} fields={{ id }} title="Mark as under review?">Under review</ConfirmAction>}
            <ConfirmAction action={rejectRequestAction} fields={{ id }} title="Reject this request?" description="The client is notified with your reason." withReason="Reason for the client" destructive variant="ghost" confirmLabel="Reject">Reject</ConfirmAction>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Request</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <DetailList items={[
              ["Date", formatDate(r.starts_at)], ["Time", `${formatTime(r.starts_at)}–${formatTime(r.ends_at)} (${r.break_minutes} min break)`],
              ["Repeats", rec?.days ? `${rec.days.map((d) => DAYS[d]).join(", ")} until ${rec.until}` : "No"],
              ["Required skills", (skills ?? []).map((s) => s.name).join(", ") || "—"], ["Language", r.required_language_code?.toUpperCase() ?? "—"],
              ["Experience", r.min_experience_months ? `${r.min_experience_months} months` : "—"], ["Client reference", r.client_reference ?? "—"],
              ["Requested by", r.profiles?.full_name ?? r.profiles?.email ?? "—"], ["Submitted", r.submitted_at ? formatDateTime(r.submitted_at) : formatDateTime(r.created_at)],
            ]} />
            {r.instructions && <div><p className="text-sm text-muted-foreground">Instructions</p><p className="whitespace-pre-wrap text-sm">{r.instructions}</p></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Shifts created</CardTitle></CardHeader>
          <CardContent>
            {!shifts?.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="space-y-1 text-sm">{shifts.map((s) => <li key={s.id}><Link className="text-primary hover:underline" href={`/admin/shifts/${s.id}`}>{formatDate(s.starts_at)}</Link> <StatusBadge status={s.status} /></li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
