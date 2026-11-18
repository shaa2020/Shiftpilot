"use client";
import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * "Install app" button. Chrome/Edge/Android/Windows/macOS use the native install
 * prompt; iPhone/iPad (Safari) show the Share → Add to Home Screen steps.
 * Hidden when already running as an installed app.
 */
export function InstallApp({ className, variant = "secondary", label = "Install app" }: { className?: string; variant?: "default" | "secondary"; label?: string }) {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const t = setTimeout(() => { setInstalled(standalone); setIos(isIos); }, 0);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as PromptEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed || (!prompt && !ios)) return null;
  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={async () => {
        if (prompt) { await prompt.prompt(); await prompt.userChoice; setPrompt(null); } else setHelp(true);
      }}>
        <Download /> {label}
      </Button>
      {help && (
        <div role="dialog" aria-label="Install ShiftPilot" className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setHelp(false)}>
          <div className={cn("glass pb-safe w-full max-w-sm rounded-3xl p-6 text-foreground")} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Install ShiftPilot</h2>
              <button type="button" aria-label="Close" onClick={() => setHelp(false)} className="rounded-full p-1 hover:bg-surface-muted"><X className="size-5" /></button>
            </div>
            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"><Share className="size-4" /></span>Tap the <strong>Share</strong> button in Safari</li>
              <li className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"><SquarePlus className="size-4" /></span>Choose <strong>Add to Home Screen</strong></li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">ShiftPilot then opens full-screen like a normal app.</p>
          </div>
        </div>
      )}
    </>
  );
}
