import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface-muted/30 px-6 py-10 text-center", className)}>
      {Icon && (
        <div className="mb-1 rounded-full bg-primary-soft p-2.5 text-primary-soft-foreground">
          <Icon className="size-5" aria-hidden />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  const toneCls = {
    neutral: "bg-surface-muted text-muted-foreground",
    info: "bg-primary-soft text-primary-soft-foreground",
    success: "bg-success-soft text-success-soft-foreground",
    warning: "bg-warning-soft text-warning-soft-foreground",
    danger: "bg-danger-soft text-danger-soft-foreground",
  }[tone];
  return (
    <div className="glass group relative overflow-hidden rounded-2xl p-4 transition-transform hover:-translate-y-0.5">
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-primary/10 blur-2xl transition-opacity group-hover:opacity-80" />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
        {Icon && (
          <span className={cn("rounded-xl p-2 shadow-sm ring-1 ring-black/5", toneCls)}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
