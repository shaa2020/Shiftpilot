"use server";
import { randomUUID } from "node:crypto";

import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { getOpening } from "@/lib/data/careers";
import { clientIp, hashIdentifier, rateLimit } from "@/lib/security/request";
import { formObject, zodErrors, type ActionState } from "@/lib/actions/state";
import { scanBytes } from "@/lib/documents/scan";
import { MAX_CV_BYTES, PRIVACY_NOTICE_VERSION, applicationSchema, detectCvType } from "@/lib/validation/application";

/**
 * Public application intake. Applicants have no account, so this runs with
 * the service role — after validation, a honeypot, shared rate limiting and
 * content-based file checks. The opening must be currently published.
 */
export async function submitApplicationAction(agencySlug: string, jobSlug: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  if (!isAdminClientConfigured()) return { ok: false, message: "Online applications are temporarily unavailable. Please try again later." };
  const parsed = applicationSchema.safeParse(formObject(fd));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please check the highlighted fields." };

  const ip = await clientIp();
  if (!(await rateLimit("apply", ip, 5, 3600)) || !(await rateLimit("apply-email", parsed.data.email, 3, 86400))) {
    return { ok: false, message: "We received several applications from you recently. Please try again later." };
  }

  const opening = await getOpening(agencySlug, jobSlug);
  if (!opening) return { ok: false, message: "This position is no longer open." };

  const file = fd.get("cv");
  let cv: { bytes: Uint8Array; mime: string; ext: string; name: string } | null = null;
  let cvScan: Awaited<ReturnType<typeof scanBytes>> = { status: "not_scanned" };
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CV_BYTES) return { errors: { cv: "The file is larger than 10 MB." } };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectCvType(bytes);
    if (!type) return { errors: { cv: "Upload a PDF or Word (.docx) file." } };
    const scan = await scanBytes(bytes);
    if (scan.status === "infected") return { errors: { cv: "This file was rejected by the virus scanner." } };
    if (scan.status === "error") return { errors: { cv: "The file could not be checked for viruses. Please try again in a moment." } };
    cvScan = scan;
    cv = { bytes, ...type, name: `cv-${parsed.data.last_name.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "applicant"}.${type.ext}` };
  }

  const admin = createAdminClient();
  const retention = new Date(Date.now() + (parsed.data.talent_pool ? 365 : 183) * 86400000).toISOString().slice(0, 10);
  const d = parsed.data;
  const { data: app, error } = await admin
    .from("applications")
    .insert({
      agency_id: opening.agency_id, job_opening_id: opening.id, first_name: d.first_name, last_name: d.last_name, email: d.email, phone: d.phone,
      city: d.city, preferred_engagement: d.preferred_engagement, motivation: d.motivation, source: d.source ?? "careers_site",
      privacy_notice_version: PRIVACY_NOTICE_VERSION, privacy_acknowledged_at: new Date().toISOString(), retention_until: retention,
    })
    .select("id")
    .single();
  if (error || !app) {
    console.error("application insert failed", error?.code);
    return { ok: false, message: "Your application could not be submitted. Please try again." };
  }

  await admin.from("consent_records").insert({
    agency_id: opening.agency_id, application_id: app.id, purpose: "talent_pool", notice_version: PRIVACY_NOTICE_VERSION,
    granted: d.talent_pool, ip_hash: hashIdentifier(ip),
  });

  if (cv) {
    const { data: type } = await admin.from("document_types").select("id").eq("agency_id", opening.agency_id).eq("key", "application_resume").single();
    if (type) {
      const { data: doc } = await admin
        .from("documents")
        .insert({ agency_id: opening.agency_id, document_type_id: type.id, owner_type: "application", application_id: app.id, title: "CV" })
        .select("id")
        .single();
      if (doc) {
        const path = `${opening.agency_id}/${doc.id}/${randomUUID()}.${cv.ext}`;
        const up = await admin.storage.from("documents").upload(path, cv.bytes, { contentType: cv.mime, upsert: false });
        if (!up.error) {
          await admin.from("document_versions").insert({
            agency_id: opening.agency_id, document_id: doc.id, version: 1, storage_path: path, file_name: cv.name, mime_type: cv.mime, size_bytes: cv.bytes.length,
            scan_status: cvScan.status === "clean" ? "clean" : "not_scanned", scan_engine: cvScan.status === "clean" ? cvScan.engine : null,
          });
          await admin.from("application_documents").insert({ agency_id: opening.agency_id, application_id: app.id, document_id: doc.id, kind: "resume" });
        }
      }
    }
  }
  return { ok: true, message: "Thank you! Your application has been received. We will contact you by email." };
}

