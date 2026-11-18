import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { escapeHtml, sendEmail } from "@/lib/integrations/email";
import { sendPush } from "@/lib/integrations/push";
import { sendWhatsApp } from "@/lib/integrations/whatsapp";

type Outcome = "sent" | "failed" | "skipped_unconfigured" | "dead";

export function notificationEmail(p: { agencyName: string; title: string; body?: string | null; url: string }) {
  const subject = `${p.title} — ${p.agencyName}`;
  const text = `${p.title}\n\n${p.body ?? ""}\n\nOpen ShiftPilot: ${p.url}\n\nYou can change which emails you receive under Notifications → Preferences.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#172033">
  <p style="color:#5b6b80;font-size:13px">${escapeHtml(p.agencyName)}</p>
  <h2 style="color:#10243A;margin:0 0 8px">${escapeHtml(p.title)}</h2>
  ${p.body ? `<p>${escapeHtml(p.body)}</p>` : ""}
  <p><a href="${escapeHtml(p.url)}" style="display:inline-block;background:#1d5fd6;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open ShiftPilot</a></p>
  <p style="color:#5b6b80;font-size:12px">Change which emails you receive under Notifications → Preferences.</p></div>`;
  return { subject, text, html };
}

/** Claims queued deliveries (SKIP LOCKED) and sends them through the configured providers. */
export async function dispatchDeliveries(limit = 50) {
  const admin = createAdminClient();
  const { data: claimed, error } = await admin.rpc("claim_notification_deliveries", { p_limit: limit });
  if (error) throw new Error(`claim failed: ${error.message}`);
  if (!claimed?.length) return { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const { data: ctxRows, error: ctxErr } = await admin.rpc("delivery_context", { p_ids: claimed.map((d) => d.id) });
  if (ctxErr) throw new Error(`context failed: ${ctxErr.message}`);
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const tally = { claimed: claimed.length, sent: 0, failed: 0, skipped: 0 };

  for (const d of claimed) {
    const c = ctxRows?.find((r) => r.delivery_id === d.id);
    let outcome: Outcome = "failed";
    let provider: string | null = null;
    let messageId: string | null = null;
    let err: string | null = null;
    if (!c || !c.title) {
      outcome = "dead";
      err = "Notification no longer exists";
    } else if (d.channel === "email") {
      provider = "resend";
      if (!c.email) { outcome = "dead"; err = "Recipient has no email"; }
      else {
        const res = await sendEmail({ to: c.email, idempotencyKey: d.idempotency_key, ...notificationEmail({ agencyName: c.agency_name, title: c.title, body: c.body, url: `${appUrl}${c.link_path ?? "/notifications"}` }) });
        if (res.status === "sent") { outcome = "sent"; messageId = res.providerMessageId; }
        else if (res.status === "not_configured") outcome = "skipped_unconfigured";
        else err = res.error;
      }
    } else if (d.channel === "push") {
      provider = "webpush";
      const subs = (c.push_subscriptions as { id: string; endpoint: string; p256dh: string; auth: string }[]) ?? [];
      if (!subs.length) { outcome = "dead"; err = "No active push subscription"; }
      for (const s of subs) {
        const res = await sendPush(s, { title: c.title, body: c.body, url: c.link_path, tag: d.notification_id ?? undefined });
        if (res.status === "sent") { outcome = "sent"; messageId = messageId ?? res.providerMessageId; }
        else if (res.status === "not_configured") { outcome = "skipped_unconfigured"; break; }
        else if (res.status === "gone") await admin.from("push_subscriptions").update({ disabled_at: new Date().toISOString() }).eq("id", s.id);
        else if (outcome !== "sent") err = res.error;
      }
      if (outcome === "failed" && !err) { outcome = "dead"; err = "All push subscriptions expired"; }
    } else if (d.channel === "whatsapp") {
      provider = "whatsapp_cloud";
      if (!c.phone) { outcome = "dead"; err = "Recipient has no phone number"; }
      else {
        const res = await sendWhatsApp(c.phone, c.title, `${c.body ?? ""} ${appUrl}${c.link_path ?? ""}`);
        if (res.status === "sent") { outcome = "sent"; messageId = res.providerMessageId; }
        else if (res.status === "not_configured") outcome = "skipped_unconfigured";
        else err = res.error;
      }
    }
    await admin.rpc("complete_notification_delivery", { p_id: d.id, p_status: outcome, p_provider: provider ?? undefined, p_message_id: messageId ?? undefined, p_error: err ?? undefined });
    if (outcome === "sent") tally.sent++;
    else if (outcome === "skipped_unconfigured") tally.skipped++;
    else tally.failed++;
  }
  return tally;
}
