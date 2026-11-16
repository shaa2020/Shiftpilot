"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useFieldError } from "./server-form";

/** Labelled control that shows the Server Action error for `name`. */
export function Field({
  name,
  label,
  hint,
  required,
  className,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const error = useFieldError(name);
  const id = `f-${name}`;
  const describedBy = [hint && !error ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {React.cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function CheckboxField({ name, label, description, defaultChecked }: { name: string; label: string; description?: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-primary" />
      <span>
        <span className="font-medium">{label}</span>
        {description && <span className="block text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
