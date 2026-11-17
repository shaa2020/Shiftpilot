"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions/state";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Subscribes this browser to Web Push and registers the endpoint for the signed-in user. */
export function PushToggle({ vapidKey, register }: { vapidKey: string; register: (s: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) => Promise<ActionState> }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "unsupported" | "denied" | "done">("idle");
  const enable = () =>
    start(async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
        const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
        const res = await register({ endpoint: json.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", userAgent: navigator.userAgent.slice(0, 300) });
        if (res.ok) {
          toast.success(res.message ?? "Enabled");
          setState("done");
        } else toast.error(res.message ?? "Failed");
      } catch {
        toast.error("This browser could not subscribe to push notifications.");
      }
    });
  if (state === "unsupported") return <p className="text-sm text-muted-foreground">This browser does not support push notifications. On iPhone, add ShiftPilot to your home screen first.</p>;
  if (state === "denied") return <p className="text-sm text-warning">Notifications are blocked for this site. Allow them in your browser settings and try again.</p>;
  return (
    <Button type="button" onClick={enable} disabled={pending || state === "done"}>
      {pending ? "Enabling…" : state === "done" ? "Enabled on this device" : "Enable push on this device"}
    </Button>
  );
}
