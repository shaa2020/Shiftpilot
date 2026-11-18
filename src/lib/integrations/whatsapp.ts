import "server-only";
import { serverEnv } from "@/lib/env";

export type WhatsAppResult = { status: "sent"; providerMessageId: string } | { status: "not_configured" } | { status: "failed"; error: string };

/**
 * WhatsApp Business Cloud API adapter. Awaiting configuration unless
 * WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set.
 *
 * Business-initiated messages outside a 24-hour service window must use an
 * approved template. Set WHATSAPP_TEMPLATE_NAME (and WHATSAPP_TEMPLATE_LANGUAGE,
 * default "nl") to a template with two body variables: {{1}} = title,
 * {{2}} = details + link. Without a template, a plain text message is sent,
 * which Meta only delivers inside an open service window.
 * Deliveries are opt-in per user (notification preferences).
 */
export function whatsappPayload(to: string, title: string, details: string, template?: { name: string; language: string }) {
  const clip = (v: string, n: number) => v.replace(/\s+/g, " ").trim().slice(0, n) || "-";
  if (template) {
    return {
      messaging_product: "whatsapp", to, type: "template",
      template: { name: template.name, language: { code: template.language }, components: [{ type: "body", parameters: [{ type: "text", text: clip(title, 200) }, { type: "text", text: clip(details, 800) }] }] },
    };
  }
  return { messaging_product: "whatsapp", to, type: "text", text: { body: `${title}\n${details}`.slice(0, 4000) } };
}

export async function sendWhatsApp(toE164: string, title: string, details: string): Promise<WhatsAppResult> {
  const token = serverEnv.whatsappToken();
  const phoneId = serverEnv.whatsappPhoneNumberId();
  if (!token || !phoneId) return { status: "not_configured" };
  const to = toE164.replace(/[^\d]/g, "");
  if (to.length < 8) return { status: "failed", error: "Invalid phone number" };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(whatsappPayload(to, title, details, process.env.WHATSAPP_TEMPLATE_NAME ? { name: process.env.WHATSAPP_TEMPLATE_NAME, language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "nl" } : undefined)),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    const id = body.messages?.[0]?.id;
    if (!res.ok || !id) return { status: "failed", error: body.error?.message ?? `HTTP ${res.status}` };
    return { status: "sent", providerMessageId: id };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "WhatsApp request failed" };
  }
}
