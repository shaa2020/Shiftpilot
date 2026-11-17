import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Plus } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { cancelRequestAction, submitDraftRequestAction } from "../actions";

export const metadata: Metadata = { title: "Staffing requests" };

export default async function ClientRequestsPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireClient();
  const { created } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("shift_requests")
    .select("id, status, headcount, starts_at, ends_at, is_urgent, recurrence, rejection_reason, client_locations(name), job_positions(name)")
    .eq("client_id", ctx.clientId)
    .order("starts_at", { ascending: false })
    .limit(200);
  return (
    <>
      <PageHeader title="Staffing requests" description="Ask the agency for workers. You are notified when the request is accepted and workers are confirmed."
        actions={ctx.capabilities.request && <Button asChild><Link href="/client/requests/new"><Plus /> Request staff</Link></Button>} />
      {created && <Alert tone="success" className="mb-4">Your request was saved.</Alert>}
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={Inbox} title="No requests yet" className="m-5" /> : (
          <Table>
            <THead><tr><TH>When</TH><TH>Position</TH><TH>Location</TH><TH>Workers</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
            <TBody>
              {data.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">{formatDate(r.starts_at)}<p className="text-xs text-muted-foreground">{formatTime(r.starts_at)}–{formatTime(r.ends_at)}{r.recurrence ? " · recurring" : ""}</p></TD>
                  <TD>{r.job_positions?.name}</TD>
                  <TD className="text-muted-foreground">{r.client_locations?.name}</TD>
                  <TD className="tabular-nums">{r.headcount}</TD>
                  <TD className="space-x-1">{r.is_urgent && <Badge tone="danger">Urgent</Badge>}<StatusBadge status={r.status} />{r.rejection_reason && <p className="text-xs text-muted-foreground">{r.rejection_reason}</p>}</TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {ctx.capabilities.request && r.status === "draft" && <ConfirmAction action={submitDraftRequestAction} fields={{ id: r.id }} title="Submit this request to the agency?" variant="soft">Submit</ConfirmAction>}
                    {ctx.capabilities.request && ["draft", "submitted", "under_review", "accepted"].includes(r.status) && (
                      <ConfirmAction action={cancelRequestAction} fields={{ id: r.id }} title="Cancel this request?" description={r.status === "accepted" ? "Shifts already scheduled stay in place; the agency will contact you." : undefined} withReason="Reason" variant="ghost" destructive confirmLabel="Cancel request">Cancel</ConfirmAction>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
