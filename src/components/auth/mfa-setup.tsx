"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/actions/state";

type Enroll = () => Promise<{ ok: true; factorId: string; qr: string; secret: string } | { ok: false; message: string }>;

/** TOTP enrolment: QR code (or secret) → first code confirms the factor. */
export function MfaSetup({ enroll, confirm }: { enroll: Enroll; confirm: (factorId: string, code: string) => Promise<ActionState> }) {
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  if (!setup)
    return (
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await enroll();
            if (res.ok) setSetup(res);
            else toast.error(res.message);
          })
        }
      >
        {pending ? "Starting…" : "Set up two-factor authentication"}
      </Button>
    );
  return (
    <div className="space-y-3">
      <p className="text-sm">Scan this code with an authenticator app (e.g. Microsoft Authenticator, Google Authenticator, 1Password), then enter the 6-digit code.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- QR is a data: SVG from Supabase */}
      <img src={setup.qr} alt="QR code for your authenticator app" className="size-44 rounded-md bg-white p-2" />
      <p className="break-all text-xs text-muted-foreground">Cannot scan? Enter this key: <code>{setup.secret}</code></p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await confirm(setup.factorId, code);
            if (res.ok) {
              toast.success(res.message ?? "Enabled");
              window.location.reload();
            } else toast.error(res.message ?? "Invalid code");
          });
        }}
      >
        <Input aria-label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" className="w-32" />
        <Button type="submit" disabled={pending || code.length !== 6}>{pending ? "Checking…" : "Confirm"}</Button>
      </form>
    </div>
  );
}
