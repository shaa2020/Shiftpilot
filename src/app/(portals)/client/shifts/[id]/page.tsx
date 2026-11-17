import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { clientReplacementAction } from "../../actions";

export const metadata: Metadata = { title: "Shift" };

export default async function ClientShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClient();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: s } = await supabase.from("shifts").select("*, client_locations(name, address_line1, city), shift_positions(headcount, filled_count, job_positions(name))").eq("id", id).eq("client_id", ctx.clientId).maybeSingle();
  if (!s) notFound();
  const { data: staff } = await supabase.rpc("client_shift_staff", { p_shift_id: id });
  return (
    <>
      <Link href="/client/shifts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Shifts</Link>
      <PageHeader title={s.title} description={`${formatDate(s.starts_at)} · ${formatTime(s.starts_at)}–${formatTime(s.ends_at)} · ${s.client_locations?.name}`} actions={<StatusBadge status={s.status} />} />
      {s.status === "cancelled" && <Alert tone="danger" title="Cancelled" className="mb-4">{s.cancellation_reason}</Alert>}
      <div className="mb-4 flex flex-wrap gap-2">
        {s.shift_positions.map((p, i) => <Badge key={i} tone={p.filled_count >= p.headcount ? "success" : "warning"}>{p.job_positions?.name}: {p.filled_count}/{p.headcount}</Badge>)}
      </div>
      <Card>
        <CardHeader><CardTitle>Workers</CardTitle></CardHeader>
        <CardContent>
          {!staff?.length ? <EmptyState icon={Users} title="No workers confirmed yet" description="You are notified when workers are confirmed." /> : (
            <ul className="divide-y divide-border">
              {staff.map((w) => (
                <li key={w.assignment_id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium">{w.worker_display_name} <span className="font-normal text-muted-foreground">· {w.position_name}</span></p>
                    {w.professional_summary && <p className="text-muted-foreground">{w.professional_summary}</p>}
                    <p className="text-xs text-muted-foreground">
                      {w.certificates.length > 0 && <>Certificates: {w.certificates.join(", ")} · </>}
                      {w.languages.length > 0 && <>Languages: {w.languages.join(", ")}</>}
                    </p>
                    <p className="text-xs">{w.checked_in_at ? `Checked in ${formatTime(w.checked_in_at)}` : "Not checked in"}{w.checked_out_at ? ` · out ${formatTime(w.checked_out_at)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={w.status} />
                    {ctx.capabilities.request && w.status === "confirmed" && (
                      <ConfirmAction action={clientReplacementAction} fields={{ id: w.assignment_id }} title="Request a replacement or report absence?" description="The agency will arrange another worker and keep you informed." withReason="Reason" variant="ghost">Request replacement</ConfirmAction>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
