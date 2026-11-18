import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { ListFilters } from "@/components/ui/list-filters";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ServerForm } from "@/components/forms/server-form";
import { verifyDocumentAction } from "./actions";

export const metadata: Metadata = { title: "Documents" };
const STATUSES = ["pending", "verified", "rejected", "expired"];

export default async function DocumentsQueuePage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireStaff("documents.read");
  const { status: rawStatus, q } = await searchParams;
  const status = rawStatus && STATUSES.includes(rawStatus) ? rawStatus : "pending";
  const supabase = await createClient();
  let query = supabase
    .from("documents")
    .select("id, title, status, issued_on, expires_on, current_version, rejection_reason, owner_type, updated_at, worker_id, client_id, document_types(name, requires_expiry), workers(first_name, last_name, worker_number), clients(name), document_versions(version, scan_status)")
    .eq("agency_id", ctx.agencyId).is("archived_at", null).eq("status", status as "pending").order("updated_at", { ascending: status !== "pending" }).limit(300);
  if (status === "pending") query = query.gt("current_version", 0);
  if (q) query = query.ilike("title", `%${q.replace(/[%_,()]/g, "")}%`);
  const { data } = await query;
  const canVerify = ctx.can("documents.verify");
  return (
    <>
      <PageHeader title="Documents" description="Verification queue for uploaded documents. Check the original file before approving; identity documents are never visible to clients." />
      <ListFilters selects={[{ name: "status", label: "Status", value: status, options: STATUSES.map((s) => [s, humanize(s)]) }]} />
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={FileCheck} title={status === "pending" ? "Nothing waiting for verification" : "No documents"} className="m-5" /> : (
          <Table>
            <THead><tr><TH>Document</TH><TH>Owner</TH><TH>Validity</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
            <TBody>
              {data.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground">{d.document_types?.name} · v{d.current_version} · updated {formatDate(d.updated_at)}</p>
                    {d.current_version > 0 && <a className="text-xs text-primary hover:underline" href={`/api/documents/${d.id}`} target="_blank" rel="noopener">Open file</a>}
                    {(() => {
                      const scan = d.document_versions.find((v) => v.version === d.current_version)?.scan_status;
                      return scan ? <span className={`ml-2 text-xs ${scan === "clean" ? "text-success" : "text-warning"}`}>{scan === "clean" ? "Virus scan: clean" : "Not virus-scanned"}</span> : null;
                    })()}
                  </TD>
                  <TD>
                    {d.workers ? <Link className="hover:underline" href={`/admin/workers/${d.worker_id}?tab=documents`}>{d.workers.first_name} {d.workers.last_name}<span className="block text-xs text-muted-foreground">{d.workers.worker_number}</span></Link>
                      : d.clients ? <Link className="hover:underline" href={`/admin/clients/${d.client_id}`}>{d.clients.name}</Link> : humanize(d.owner_type)}
                  </TD>
                  <TD className="text-muted-foreground">{d.issued_on ?? "?"} → {d.expires_on ?? (d.document_types?.requires_expiry ? "expiry required" : "no expiry")}</TD>
                  <TD><StatusBadge status={d.status} />{d.rejection_reason && <p className="text-xs text-muted-foreground">{d.rejection_reason}</p>}</TD>
                  <TD className="text-right">
                    {canVerify && d.status === "pending" && (
                      <div className="flex flex-wrap items-end justify-end gap-2">
                        <ServerForm action={verifyDocumentAction} submitLabel="Verify" pendingLabel="…" className="flex items-end gap-2" footerClassName="m-0">
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="approve" value="true" />
                          {d.document_types?.requires_expiry && <label className="text-left text-xs text-muted-foreground">Expires<Input name="expires_on" type="date" defaultValue={d.expires_on ?? ""} className="h-8 w-36" /></label>}
                        </ServerForm>
                        <ConfirmAction action={verifyDocumentAction} fields={{ id: d.id, approve: "false" }} title="Reject document?" description="The worker is notified with your reason and can upload a new version." withReason="Reason" variant="ghost" destructive confirmLabel="Reject">Reject</ConfirmAction>
                      </div>
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
