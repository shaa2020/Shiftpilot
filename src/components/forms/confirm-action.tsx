"use client";
import { useState, useTransition } from "react";
import { AlertDialog } from "radix-ui";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions/state";

/**
 * Button that asks for confirmation, then runs a Server Action.
 * The action receives the hidden fields as FormData.
 */
export function ConfirmAction({
  action,
  fields = {},
  title,
  description,
  confirmLabel = "Confirm",
  children,
  variant = "secondary",
  size = "sm",
  destructive,
  withReason,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields?: Record<string, string>;
  title: string;
  description?: string;
  confirmLabel?: string;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  destructive?: boolean;
  withReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      if (withReason) fd.set("reason", reason);
      const res = await action({}, fd);
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setOpen(false);
      } else toast.error(res.message ?? "The action failed");
    });

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger asChild>
        <Button variant={variant} size={size} type="button">{children}</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xl">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground">{description ?? "Please confirm."}</AlertDialog.Description>
          {withReason && (
            <div className="space-y-1.5">
              <label htmlFor="confirm-reason" className="text-sm font-medium">{withReason}</label>
              <textarea
                id="confirm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" type="button">Cancel</Button>
            </AlertDialog.Cancel>
            <Button type="button" variant={destructive ? "destructive" : "default"} onClick={run} disabled={pending || (!!withReason && reason.trim().length < 3)}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
