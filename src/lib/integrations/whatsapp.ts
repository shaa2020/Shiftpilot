import "server-only";
import { serverEnv } from "@/lib/env";

export type WhatsAppResult = { status: "sent"; providerMessageId: string } | { status: "not_configured" } | { status: "failed"; error: string };

/**
 * WhatsApp Business Cloud API adapter. Awaiting configuration unless
 * WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set. Business-initiated
 * conversations normally require approved templates; this adapter sends a text
 * message, which Meta only accepts inside an open 24-hour service window.
 * Deliveries are opt-in per user (notification preferences).
 */
export async function sendWhatsApp(toE164: string, text: string): Promise<WhatsAppResult> {
  const token = serverEnv.whatsappToken();
  const phoneId = serverEnv.whatsappPhoneNumberId();
  if (!token || !phoneId) return { status: "not_configured" };
  const to = toE164.replace(/[^\d]/g, "");
  if (to.length < 8) return { status: "failed", error: "Invalid phone number" };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4000) } }),
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
