import "server-only";
import webpush from "web-push";
import { serverEnv, vapidPublicKey } from "@/lib/env";

export type PushResult = { status: "sent"; providerMessageId: string } | { status: "not_configured" } | { status: "gone" } | { status: "failed"; error: string };

export function isPushConfigured() {
  return Boolean(vapidPublicKey() && serverEnv.vapidPrivateKey() && serverEnv.vapidSubject());
}

/** Web Push (VAPID). A 404/410 from the push service means the subscription is gone. */
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body?: string | null; url?: string | null; tag?: string }): Promise<PushResult> {
  if (!isPushConfigured()) return { status: "not_configured" };
  try {
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: payload.title, body: payload.body ?? "", url: payload.url ?? "/notifications", tag: payload.tag }),
      { vapidDetails: { subject: serverEnv.vapidSubject()!, publicKey: vapidPublicKey()!, privateKey: serverEnv.vapidPrivateKey()! }, TTL: 3600, timeout: 10_000 },
    );
    return { status: "sent", providerMessageId: res.headers?.location ?? `push-${res.statusCode}-${Date.now()}` };
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return { status: "gone" };
    return { status: "failed", error: e instanceof Error ? e.message : "Push failed" };
  }
}
