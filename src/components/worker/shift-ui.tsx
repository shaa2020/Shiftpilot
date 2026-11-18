import Link from "next/link";
import { ChevronRight, Clock, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTime } from "@/lib/time";
import { dateTile, durationLabel, shiftLength } from "@/lib/shift-format";
import { cn } from "@/lib/utils";

/** Calendar-style date tile: "Wed / 2 / Dec". */
export function DateTile({ iso, className }: { iso: string; className?: string }) {
  const t = dateTile(iso);
  return (
    <div className={cn("flex w-14 shrink-0 flex-col items-center self-start overflow-hidden rounded-xl border border-border bg-surface text-center shadow-sm", className)} aria-hidden>
      <span className="w-full bg-primary py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">{t.weekday}</span>
      <span className="pt-1 text-xl font-bold leading-none tabular-nums">{t.day}</span>
      <span className="pb-1.5 text-[11px] text-muted-foreground">{t.month}</span>
    </div>
  );
}

/** Icon + label + content row used on shift details. */
export function DetailRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground"><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

export interface ShiftCardData {
  href?: string;
  title: string;
  starts_at: string;
  ends_at: string;
  break_minutes?: number | null;
  position?: string | null;
  client?: string | null;
  location?: string | null;
  city?: string | null;
  status?: string;
  chip?: { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" } | null;
}

/** Compact, tappable shift summary used in lists. */
export function ShiftCard({ s, children }: { s: ShiftCardData; children?: React.ReactNode }) {
  const len = shiftLength(s.starts_at, s.ends_at, s.break_minutes ?? 0);
  const body = (
    <div className="flex gap-3 p-3.5 sm:p-4">
      <DateTile iso={s.starts_at} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 font-semibold leading-snug">{s.title}</p>
          {s.status && <StatusBadge status={s.status} />}
        </div>
        {(s.position || s.client) && <p className="truncate text-sm text-muted-foreground">{[s.position, s.client].filter(Boolean).join(" · ")}</p>}
        <p className="flex items-center gap-1.5 text-sm">
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="tabular-nums">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span>
          <span className="text-muted-foreground">· {durationLabel(len.total)}</span>
        </p>
        {(s.location || s.city) && (
          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{[s.location, s.city].filter(Boolean).join(", ")}</span>
          </p>
        )}
        {s.chip && <Badge tone={s.chip.tone} className="mt-1">{s.chip.label}</Badge>}
        {children}
      </div>
      {s.href && <ChevronRight className="mt-5 size-5 shrink-0 self-start text-muted-foreground" aria-hidden />}
    </div>
  );
  const cls = "block overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] transition-colors";
  return s.href ? (
    <Link href={s.href} className={cn(cls, "hover:border-primary/50 active:scale-[0.995]")}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
