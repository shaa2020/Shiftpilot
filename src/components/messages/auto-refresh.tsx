"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** True while the user is writing in a form field, so a refresh never interferes. */
function isTyping() {
  return [...document.querySelectorAll("textarea")].some((t) => t.value.length > 0);
}

/**
 * Re-fetches the server-rendered page every `ms` while the tab is visible and
 * the user is not typing. With `soon`, also refreshes once shortly after
 * opening (so badges reflect a thread that was just marked read).
 */
export function AutoRefresh({ ms = 15000, soon = false }: { ms?: number; soon?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && !isTyping()) router.refresh();
    };
    const id = setInterval(tick, ms);
    const first = soon ? setTimeout(tick, 600) : undefined;
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      if (first) clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, soon, router]);
  return null;
}
