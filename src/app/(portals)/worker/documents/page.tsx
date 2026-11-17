import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDate, nowMs } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { uploadOwnDocumentAction } from "./actions";

export const metadata: Metadata = { title: "My documents" };

export default async function WorkerDocumentsPage() {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const { data: list } = await supabase.rpc("worker_document_checklist", { p_worker_id: ctx.workerId });
  const today = localDate(new Date());
  const soon = localDate(new Date(nowMs() + 30 * 86400000));
  return (
    <>
      <PageHeader title="My documents" description="Upload certificates and required documents. Only you and authorised agency staff can see them; identity documents are never shared with clients." />
      {!list?.length ? <EmptyState icon={FileText} title="No document types configured" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((d) => {
            const expired = d.expires_on && d.expires_on < today;
            const expiring = d.expires_on && !expired && d.expires_on <= soon;
            return (
              <Card key={d.document_type_id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    {d.name}
                    {d.required && <Badge tone="warning">Required</Badge>}
                    {d.document_id ? <StatusBadge status={expired ? "expired" : d.status ?? "pending"} /> : <Badge>Missing</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {d.expires_on ? <span className={expired ? "text-danger" : expiring ? "text-warning" : ""}>Valid until {d.expires_on}{expiring ? " — renew soon" : ""}</span> : d.requires_expiry ? "Expiry date required" : ""}
                    {d.document_id ? ` · version ${d.current_version}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {d.document_id && d.current_version > 0 && <a href={`/api/documents/${d.document_id}`} className="mb-3 inline-block text-sm text-primary hover:underline">View current file</a>}
                  <ServerForm action={uploadOwnDocumentAction} submitLabel={d.document_id ? "Upload new version" : "Upload"} pendingLabel="Uploading…" resetOnSuccess>
                    <input type="hidden" name="document_type_id" value={d.document_type_id} />
                    <input type="hidden" name="document_id" value={d.document_id ?? ""} />
                    <Field name="file" label="File (PDF or photo, max 10 MB)"><input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary-soft-foreground" /></Field>
                    {!d.document_id && d.requires_expiry && (
                      <div className="grid grid-cols-2 gap-3">
                        <Field name="issued_on" label="Issued on"><Input name="issued_on" type="date" /></Field>
                        <Field name="expires_on" label="Expires on"><Input name="expires_on" type="date" /></Field>
                      </div>
                    )}
                  </ServerForm>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
