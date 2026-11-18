"use client";
import { createContext, useActionState, useContext, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/actions/state";
import { SubmitButton } from "./submit-button";

const ErrorsContext = createContext<Record<string, string | undefined>>({});

export function useFieldError(name: string) {
  return useContext(ErrorsContext)[name];
}

/**
 * Generic form bound to a Server Action returning ActionState. Field errors are
 * provided through context so server-rendered <Field> children can show them.
 */
export function ServerForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  resetOnSuccess = false,
  toastOnSuccess = true,
  className,
  footerClassName,
  hideSubmit,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  resetOnSuccess?: boolean;
  toastOnSuccess?: boolean;
  className?: string;
  footerClassName?: string;
  hideSubmit?: boolean;
}) {
  // The success toast is raised as soon as the action returns, so it still shows
  // when the refreshed page no longer renders this form (e.g. a list that empties).
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await action(prev, fd);
    if (result.ok && toastOnSuccess && result.message) toast.success(result.message);
    return result;
  }, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <ErrorsContext.Provider value={state.errors ?? {}}>
      <form ref={ref} action={formAction} className={cn("space-y-4", className)} noValidate>
        {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
        {state.ok && !toastOnSuccess && state.message && <Alert tone="success">{state.message}</Alert>}
        {children}
        {!hideSubmit && (
          <div className={cn("flex justify-end", footerClassName)}>
            <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
          </div>
        )}
      </form>
    </ErrorsContext.Provider>
  );
}
