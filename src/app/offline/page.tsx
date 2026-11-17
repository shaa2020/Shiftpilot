import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="text-sm text-muted-foreground">
        ShiftPilot needs a connection to load this page. Check-ins and check-outs you recorded while offline are kept on this device and sent automatically when you reconnect.
      </p>
      <a href="/portal" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</a>
    </main>
  );
}
