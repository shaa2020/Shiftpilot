"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions/state";
import { SubmitButton } from "./submit-button";

/** Form for any invitation action; shows the one-time link when email is not configured. */
export function InvitationForm({
  action,
  children,
  submitLabel = "Send invitation",
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      if (state.data?.delivery === "sent") toast.success(state.message);
    }
  }, [state]);
  return (
    <div className="space-y-4">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
      {state.errors && Object.values(state.errors).some(Boolean) && (
        <Alert tone="danger">{Object.values(state.errors).filter(Boolean).join(" ")}</Alert>
      )}
      {state.ok && state.data?.link && (
        <Alert tone="warning" title="Share this link">
          <p>{state.message}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs text-foreground">{state.data.link}</code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.data!.link);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Alert>
      )}
      <form ref={ref} action={formAction} className="space-y-4" noValidate>
        {children}
        <SubmitButton className="w-full" pendingLabel="Sending…">{submitLabel}</SubmitButton>
      </form>
    </div>
  );
}
