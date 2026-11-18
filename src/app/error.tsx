"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Errors that mean the page is from an older deployment; a reload fixes them. */
const STALE = /server action|failed to find|chunkloaderror|loading chunk|failed to fetch dynamically imported module|deployment/i;

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
    if (STALE.test(error.message ?? "")) {
      try {
        if (!sessionStorage.getItem("sp-stale-reload")) {
          sessionStorage.setItem("sp-stale-reload", "1");
          window.location.reload();
          return;
        }
      } catch {}
    }
    try { sessionStorage.removeItem("sp-stale-reload"); } catch {}
  }, [error]);
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The action could not be completed. Nothing was changed unless you saw a confirmation. If the app was just updated, reloading usually fixes this.
        {error.digest && <span className="mt-1 block text-xs">Reference: {error.digest}</span>}
      </p>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>Reload page</Button>
        <Button onClick={() => { router.refresh(); reset(); }} variant="secondary">Try again</Button>
      </div>
    </main>
  );
}
