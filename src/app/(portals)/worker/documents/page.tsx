import type { Metadata } from "next";
import { CheckCircle2, Clock, Eye, FileText, Inbox } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDate } from "@/lib/time";
import { documentState, dueLabel } from "@/lib/documents/format";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { cn } from "@/lib/utils";
import { uploadOwnDocumentAction } from "./actions";

export const metadata: Metadata = { title: "My documents" };

const FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const fileInput = "block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:font-medium file:text-primary-soft-foreground";

function UploadForm({ typeId, documentId, label, askDates, id }: { typeId: string; documentId: string | null; label: string; askDates: boolean; id: string }) {
  return (
    <ServerForm action={uploadOwnDocumentAction} submitLabel={label} pendingLabel="Uploading…" resetOnSuccess className="space-y-3" footerClassName="justify-start">
      <input type="hidden" name="document_type_id" value={typeId} />
      <input type="hidden" name="document_id" value={documentId ?? ""} />
      <Field name="file" label="File" hint="PDF or a photo (JPG, PNG, WebP), max 10 MB. On a phone you can take a picture.">
        <input name="file" type="file" accept={FILE_ACCEPT} className={fileInput} data-upload={id} />
      </Field>
      {askDates && (
        <div className="grid grid-cols-2 gap-3">
          <Field name="issued_on" label="Issued on"><Input name="issued_on" type="date" /></Field>
          <Field name="expires_on" label="Valid until"><Input name="expires_on" type="date" /></Field>
        </div>
      )}
    </ServerForm>
  );
}

export default async function WorkerDocumentsPage() {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const today = localDate(new Date());
  const [{ data: list }, { data: requests }, { data: docs }] = await Promise.all([
    supabase.rpc("worker_document_checklist", { p_worker_id: ctx.workerId }),
    supabase.rpc("worker_document_requests", { p_worker_id: ctx.workerId }),
    supabase.from("documents").select("id, rejection_reason, issued_on").eq("worker_id", ctx.workerId).is("archived_at", null),
  ]);
  const reasons = new Map((docs ?? []).map((d) => [d.id, d.rejection_reason]));
  const open = (requests ?? []).filter((r) => r.status === "open" || r.status === "submitted");
  const closed = (requests ?? []).filter((r) => r.status === "completed").slice(0, 10);
  const openDocIds = new Set(open.map((r) => r.document_id));
  // Documents the agency issues (contracts, payslips) are not uploaded by the worker.
  const AGENCY_ISSUED = new Set(["employment_contract", "payslip", "freelancer_agreement", "additional_document"]);
  const all = (list ?? []).filter((d) => !AGENCY_ISSUED.has(d.key) || (d.current_version > 0));
  const required = all.filter((d) => d.required);
  const optional = all.filter((d) => !d.required);
  const doneCount = required.filter((d) => ["verified", "expiring"].includes(documentState(d, today).key)).length;
  const pct = required.length ? Math.round((doneCount / required.length) * 100) : 100;

  const DocCard = ({ d }: { d: NonNullable<typeof list>[number] }) => {
    const st = documentState({ ...d, requested: !!d.document_id && openDocIds.has(d.document_id) }, today);
    const reason = d.document_id ? reasons.get(d.document_id) : null;
    const issuedByAgency = AGENCY_ISSUED.has(d.key);
    const needsUpload = !issuedByAgency && ["missing", "requested", "rejected", "expired", "expiring"].includes(st.key);
    return (
      <Card className={cn(st.key === "rejected" || st.key === "expired" ? "border-danger/40" : "")}>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-start gap-3">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", st.key === "verified" ? "bg-success-soft text-success-soft-foreground" : "bg-primary-soft text-primary-soft-foreground")}>
              {st.key === "verified" ? <CheckCircle2 className="size-5" aria-hidden /> : <FileText className="size-5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">{d.name}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone={st.tone}>{st.label}</Badge>
                {d.required && <Badge tone="warning">Required</Badge>}
              </div>
            </div>
          </div>
          {(d.expires_on || d.current_version > 0) && (
            <p className="text-sm text-muted-foreground">
              {d.expires_on && <>Valid until <span className={st.key === "expired" ? "font-medium text-danger" : st.key === "expiring" ? "font-medium text-warning" : ""}>{formatDate(d.expires_on)}</span></>}
              {d.expires_on && d.current_version > 0 && " · "}
              {d.current_version > 0 && `version ${d.current_version}`}
            </p>
          )}
          {st.key === "rejected" && reason && <p className="rounded-lg bg-danger-soft p-2.5 text-sm text-danger-soft-foreground"><span className="font-semibold">Why it was rejected: </span>{reason}</p>}
          {st.key === "review" && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="size-4" aria-hidden /> The agency will check it soon.</p>}
          {d.document_id && d.current_version > 0 && (
            <a href={`/api/documents/${d.document_id}/file`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Eye className="size-4" aria-hidden /> View my file</a>
          )}
          {needsUpload && !d.required && st.key === "missing" ? (
            <details className="group text-sm">
              <summary className="inline-flex cursor-pointer list-none items-center rounded-md bg-primary-soft px-3 py-2 font-medium text-primary-soft-foreground group-open:hidden">Add this document</summary>
              <div className="mt-1"><UploadForm id={d.document_type_id} typeId={d.document_type_id} documentId={d.document_id} label="Upload" askDates={d.requires_expiry && !d.document_id} /></div>
            </details>
          ) : needsUpload ? (
            <UploadForm id={d.document_type_id} typeId={d.document_type_id} documentId={d.document_id} label={d.current_version > 0 ? "Upload new version" : "Upload"} askDates={d.requires_expiry && !d.document_id} />
          ) : issuedByAgency ? (
            <p className="text-xs text-muted-foreground">Provided by the agency.</p>
          ) : (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Replace with a newer file</summary>
              <div className="mt-3"><UploadForm id={`r-${d.document_type_id}`} typeId={d.document_type_id} documentId={d.document_id} label="Upload new version" askDates={false} /></div>
            </details>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="My documents" description="Only you and authorised agency staff can see these. Identity documents are never shared with clients." />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-medium">{required.length === 0 ? "No required documents" : doneCount === required.length ? "All required documents are verified" : "Required documents"}</span>
            <span className="text-muted-foreground">{doneCount} of {required.length} verified</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Required documents verified">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
          </div>
        </CardContent>
      </Card>

      {open.length > 0 && (
        <section className="mb-8" aria-labelledby="requested">
          <h2 id="requested" className="mb-3 flex items-center gap-2 text-lg font-semibold"><Inbox className="size-5 text-primary" aria-hidden /> Requested by your agency</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((r) => {
              const due = r.status === "open" ? dueLabel(r.due_on, today) : null;
              const rejected = r.document_status === "rejected" && r.status === "open";
              return (
                <Card key={r.id} className={cn("border-l-4", due?.overdue || rejected ? "border-l-danger" : r.status === "submitted" ? "border-l-primary" : "border-l-warning")}>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-start gap-2">
                      <p className="min-w-0 flex-1 font-semibold">{r.title}</p>
                      {r.status === "submitted" ? <Badge tone="info">Uploaded — being checked</Badge> : due ? <Badge tone={due.overdue ? "danger" : "warning"}>{due.label}</Badge> : <Badge tone="warning">Please upload</Badge>}
                    </div>
                    {r.message && <p className="rounded-lg bg-surface-muted p-2.5 text-sm">{r.message}</p>}
                    <p className="text-xs text-muted-foreground">Requested {formatDate(r.created_at)}{r.due_on ? ` · due ${formatDate(r.due_on)}` : ""}</p>
                    {rejected && r.rejection_reason && <p className="rounded-lg bg-danger-soft p-2.5 text-sm text-danger-soft-foreground"><span className="font-semibold">Please upload again: </span>{r.rejection_reason}</p>}
                    {r.status === "open" && <UploadForm id={r.id} typeId={r.document_type_id} documentId={r.document_id} label="Upload" askDates={false} />}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {!all.length ? <EmptyState icon={FileText} title="No documents needed yet" /> : (
        <>
          {required.length > 0 && (
            <section className="mb-8" aria-labelledby="required">
              <h2 id="required" className="mb-3 text-lg font-semibold">Required</h2>
              <div className="grid gap-3 md:grid-cols-2">{required.map((d) => <DocCard key={d.document_type_id} d={d} />)}</div>
            </section>
          )}
          {optional.length > 0 && (
            <section className="mb-8" aria-labelledby="optional">
              <h2 id="optional" className="mb-1 text-lg font-semibold">Other documents</h2>
              <p className="mb-3 text-sm text-muted-foreground">Certificates and diplomas help you get matched to more shifts.</p>
              <div className="grid gap-3 md:grid-cols-2">{optional.map((d) => <DocCard key={d.document_type_id} d={d} />)}</div>
            </section>
          )}
        </>
      )}

      {closed.length > 0 && (
        <details className="rounded-xl border border-border bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-medium">Completed requests ({closed.length})</summary>
          <ul className="mt-3 divide-y divide-border">
            {closed.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                <span className="flex-1">{r.title}</span>
                <span className="text-xs text-muted-foreground">{r.completed_at ? formatDate(r.completed_at) : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
