"use client";
import { useState } from "react";
import { Star } from "lucide-react";
import { ServerForm } from "@/components/forms/server-form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { rateAssignmentAction } from "./actions";

export function RatingForm({ assignmentId }: { assignmentId: string }) {
  const [value, setValue] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <ServerForm action={rateAssignmentAction} submitLabel="Save rating" pendingLabel="Saving…" className="space-y-2" footerClassName="justify-start">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="rating" value={value || ""} />
      <div role="radiogroup" aria-label="Rating" className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
            onClick={() => setValue(i)}
            onMouseEnter={() => setHover(i)}
            className="rounded p-0.5 transition-transform hover:scale-110"
          >
            <Star className={cn("size-6", i <= shown ? "fill-amber-400 text-amber-400" : "text-border")} aria-hidden />
          </button>
        ))}
      </div>
      <Input name="comment" maxLength={1000} placeholder="Comment (optional)" aria-label="Comment" />
    </ServerForm>
  );
}
