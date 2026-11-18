import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldError } from "./field-error";

/**
 * Labelled control that shows the Server Action error for `name`.
 * Rendered on the server: the control is cloned here (where it is always a
 * real element) to attach the id the label points to; only the error message
 * is a client component.
 */
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
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = `f-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const control = React.isValidElement(children) ? React.cloneElement(children, { id, "aria-describedby": hintId }) : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {control}
      {hint && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError name={name} id={id} hintId={hintId} />
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
