import { cn } from "@/lib/utils";

/** Staffing progress for a shift: "3 / 4 staffed" with a bar. */
export function FillBar({ filled, total, className }: { filled: number; total: number; className?: string }) {
  const pct = total ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  const full = total > 0 && filled >= total;
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className={cn("font-medium", full ? "text-success" : "text-warning")}>{full ? "Fully staffed" : `${total - filled} still open`}</span>
        <span className="tabular-nums text-muted-foreground">{filled}/{total}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={filled} aria-label="Workers confirmed">
        <div className={cn("h-full rounded-full", full ? "bg-success" : "bg-warning")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-sm font-semibold text-primary-foreground", className)} aria-hidden>
      {initials(name)}
    </span>
  );
}
