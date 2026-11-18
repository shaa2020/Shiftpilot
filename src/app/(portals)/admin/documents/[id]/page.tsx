import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, FileText, History, ShieldCheck, UserRound } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, localDate } from "@/lib/time";
import { documentState, fileSize, REQUEST_STATUS } from "@/lib/documents/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { archiveDocumentAction, staffUploadDocumentAction, updateDocumentDetailsAction, verifyDocumentAction } from "../actions";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("documents.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: d } = await supabase
    .from("documents")
    .select("id, agency_id, title, status, issued_on, expires_on, current_version, rejection_reason, verified_at, archived_at, created_at, owner_type, worker_id, client_id, document_type_id, document_types(name, requires_expiry, is_sensitive, applies_to), workers(first_name, last_name, worker_number, user_id), clients(name), document_versions(id, version, file_name, mime_type, size_bytes, scan_status, created_at, uploaded_by)")
    .eq("id", id)
    .maybeSingle();
  if (!d || d.agency_id !== ctx.agencyId) notFound();
  const { data: requests } = await supabase.from("document_requests").select("id, title, message, status, due_on, created_at").eq("document_id", id).order("created_at", { ascending: false });
  const today = localDate(new Date());
  const versions = [...d.document_versions].sort((a, b) => b.version - a.version);
  const current = versions.find((v) => v.version === d.current_version);
  const st = documentState({ ...d, requested: !!requests?.some((r) => r.status === "open") }, today);
  const canVerify = ctx.can("documents.verify");
  const canUpload = ctx.can("documents.upload");
  const owner = d.workers ? `${d.workers.first_name} ${d.workers.last_name}` : d.clients?.name ?? "Agency";
  const ownerHref = d.worker_id ? `/admin/workers/${d.worker_id}?tab=documents` : d.client_id ? `/admin/clients/${d.client_id}` : null;
  const by = (uid: string | null) => (uid && d.workers?.user_id === uid ? "the worker" : "agency staff");
  const isImage = current?.mime_type.startsWith("image/");
  const fileUrl = `/api/documents/${id}/file`;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/documents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Documents</Link>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="size-4" aria-hidden />
            {ownerHref ? <Link href={ownerHref} className="font-medium text-foreground hover:underline">{owner}</Link> : owner}
            {d.workers?.worker_number && <span>· {d.workers.worker_number}</span>}
            <span>· {d.document_types?.name}</span>
            {d.document_types?.is_sensitive && <Badge tone="warning"><ShieldCheck className="size-3" aria-hidden /> Sensitive</Badge>}
          </p>
        </div>
        <Badge tone={st.tone} className="text-sm">{st.label}</Badge>
      </div>
      {d.archived_at && <Alert tone="warning" className="mb-4">Archived on {formatDate(d.archived_at)}. The file history is kept for the retention period.</Alert>}
      {d.status === "rejected" && d.rejection_reason && <Alert tone="danger" title="Rejected" className="mb-4">{d.rejection_reason}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Current file</CardTitle>
                <CardDescription>{current ? `Version ${current.version} · ${current.file_name} · ${fileSize(current.size_bytes)}` : "Nothing uploaded yet"}</CardDescription>
              </div>
              {current && (
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="secondary"><a href={fileUrl} target="_blank" rel="noopener"><ExternalLink aria-hidden /> Open</a></Button>
                  <Button asChild size="sm" variant="secondary"><a href={`/api/documents/${id}`}><Download aria-hidden /> Download</a></Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!current ? (
                <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface-muted/40 py-14 text-center text-sm text-muted-foreground">
                  <FileText className="mb-2 size-8" aria-hidden />
                  {requests?.some((r) => r.status === "open") ? "Requested — waiting for the worker to upload." : "No file yet."}
                </div>
              ) : isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl} alt={`Preview of ${d.title}`} className="max-h-[70vh] w-full rounded-lg border border-border bg-surface-muted object-contain" />
              ) : (
                <a href={fileUrl} target="_blank" rel="noopener" className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted/50 p-5 hover:border-primary/50">
                  <span className="grid size-12 place-items-center rounded-lg bg-danger-soft text-danger-soft-foreground text-xs font-bold">PDF</span>
                  <span className="text-sm"><span className="block font-medium">{current.file_name}</span><span className="text-muted-foreground">Open the PDF in a new tab to check it</span></span>
                </a>
              )}
              {current && <p className="mt-3 text-xs text-muted-foreground">Uploaded {formatDateTime(current.created_at)} by {by(current.uploaded_by)} · {current.scan_status === "clean" ? <span className="text-success">virus scan clean</span> : <span className="text-warning">not virus-scanned</span>}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" aria-hidden /> Version history</CardTitle><CardDescription>Every upload is kept; files cannot be changed or deleted.</CardDescription></CardHeader>
            <CardContent>
              {!versions.length ? <p className="text-sm text-muted-foreground">No uploads yet.</p> : (
                <ol className="divide-y divide-border">
                  {versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <Badge tone={v.version === d.current_version ? "info" : "neutral"}>v{v.version}</Badge>
                      <span className="min-w-0 flex-1 truncate">{v.file_name} <span className="text-muted-foreground">· {fileSize(v.size_bytes)} · {formatDateTime(v.created_at)} · by {by(v.uploaded_by)}</span></span>
                      <a href={`/api/documents/${id}?version=${v.version}`} className="text-primary hover:underline">Download</a>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          {canVerify && d.status !== "verified" && d.current_version > 0 && !d.archived_at && (
            <Card className="border-primary/40 ring-1 ring-primary/15">
              <CardHeader><CardTitle>Review</CardTitle><CardDescription>Check the original file before you approve it.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <ServerForm action={verifyDocumentAction} submitLabel="Verify document" pendingLabel="Verifying…" footerClassName="justify-start">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="approve" value="true" />
                  {d.document_types?.requires_expiry && (
                    <div className="space-y-1.5"><label htmlFor="verify-expires" className="text-sm font-medium">Valid until <span className="text-danger">*</span></label><Input id="verify-expires" name="expires_on" type="date" defaultValue={d.expires_on ?? ""} /></div>
                  )}
                </ServerForm>
                <ConfirmAction action={verifyDocumentAction} fields={{ id, approve: "false" }} title="Reject this document?" description="The worker is notified with your reason and can upload a new version. An open request stays open." withReason="Reason shown to the worker" destructive variant="secondary" confirmLabel="Reject">Reject…</ConfirmAction>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              {canVerify && !d.archived_at ? (
                <ServerForm action={updateDocumentDetailsAction} submitLabel="Save details">
                  <input type="hidden" name="id" value={id} />
                  <Field name="title" label="Name" required><Input name="title" defaultValue={d.title} maxLength={200} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field name="issued_on" label="Issued on"><Input name="issued_on" type="date" defaultValue={d.issued_on ?? ""} /></Field>
                    <Field name="expires_on" label="Valid until"><Input name="expires_on" type="date" defaultValue={d.expires_on ?? ""} /></Field>
                  </div>
                </ServerForm>
              ) : (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">Issued</dt><dd>{d.issued_on ? formatDate(d.issued_on) : "—"}</dd>
                  <dt className="text-muted-foreground">Valid until</dt><dd>{d.expires_on ? formatDate(d.expires_on) : "—"}</dd>
                </dl>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4 text-sm">
                <dt className="text-muted-foreground">Created</dt><dd>{formatDate(d.created_at)}</dd>
                <dt className="text-muted-foreground">Verified</dt><dd>{d.verified_at && d.status === "verified" ? formatDate(d.verified_at) : "—"}</dd>
                <dt className="text-muted-foreground">Versions</dt><dd>{d.current_version}</dd>
              </dl>
            </CardContent>
          </Card>

          {!!requests?.length && (
            <Card>
              <CardHeader><CardTitle>Requests</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {requests.map((r) => (
                    <li key={r.id} className="rounded-lg bg-surface-muted p-2.5">
                      <p className="flex items-center gap-2"><span className="flex-1 font-medium">{r.title}</span><Badge tone={REQUEST_STATUS[r.status]?.tone}>{REQUEST_STATUS[r.status]?.label ?? r.status}</Badge></p>
                      <p className="text-xs text-muted-foreground">Requested {formatDate(r.created_at)}{r.due_on ? ` · due ${formatDate(r.due_on)}` : ""}</p>
                      {r.message && <p className="mt-1 text-muted-foreground">“{r.message}”</p>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {canUpload && d.worker_id && !d.archived_at && (
            <Card>
              <CardHeader><CardTitle>Upload a new version</CardTitle><CardDescription>For a file the worker gave you by email or on paper.</CardDescription></CardHeader>
              <CardContent>
                <ServerForm action={staffUploadDocumentAction.bind(null, { workerId: d.worker_id })} submitLabel="Upload" pendingLabel="Uploading…" resetOnSuccess>
                  <input type="hidden" name="document_type_id" value={d.document_type_id} />
                  <input type="hidden" name="document_id" value={id} />
                  <Field name="file" label="File (PDF, JPG, PNG or WebP, max 10 MB)"><input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary-soft-foreground" /></Field>
                </ServerForm>
              </CardContent>
            </Card>
          )}

          {canUpload && !d.archived_at && (
            <ConfirmAction action={archiveDocumentAction} fields={{ id, ...(d.worker_id ? { worker_id: d.worker_id } : {}) }} title="Archive this document?" description="It leaves the worker's checklist. Files and history are kept for the retention period." destructive variant="ghost" confirmLabel="Archive">Archive document</ConfirmAction>
          )}
        </div>
      </div>
    </div>
  );
}
