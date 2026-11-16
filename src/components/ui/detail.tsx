import { cn } from "@/lib/utils";

export function DetailList({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 font-medium text-foreground">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTabs({ tabs, active }: { tabs: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav aria-label="Sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <a
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
            t.key === active ? "border-primary font-medium text-foreground" : "border-transparent",
          )}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}
