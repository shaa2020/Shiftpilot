"use client";
import { useEffect } from "react";
import { useFieldError } from "./server-form";

/** Shows the Server Action error for a field and marks its control invalid. */
export function FieldError({ name, id, hintId }: { name: string; id: string; hintId?: string }) {
  const error = useFieldError(name);
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    if (error) {
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", `${id}-error`);
    } else {
      el.removeAttribute("aria-invalid");
      if (hintId) el.setAttribute("aria-describedby", hintId); else el.removeAttribute("aria-describedby");
    }
  }, [error, id, hintId]);
  if (!error) return null;
  return <p id={`${id}-error`} className="text-xs text-danger">{error}</p>;
}
