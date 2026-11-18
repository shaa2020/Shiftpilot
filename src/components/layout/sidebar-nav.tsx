"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell, Briefcase, Ellipsis, Building2, CalendarDays, Clock, FileText, HardHat, Home, LayoutDashboard, Megaphone, Menu, Receipt, Settings, Shield, SlidersHorizontal, Target, Users,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand";
import type { NavIcon, NavSection } from "./nav-config";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, settings: Settings, users: Users, shield: Shield, briefcase: Briefcase,
  calendar: CalendarDays, clock: Clock, receipt: Receipt, home: Home, file: FileText, bell: Bell,
  building: Building2, hardhat: HardHat, target: Target, megaphone: Megaphone, sliders: SlidersHorizontal,
};

function isActive(pathname: string, href: string) {
  const portalRoot = href.split("/").length === 2;
  return portalRoot ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

export function SidebarNav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  // The most specific matching item wins (e.g. /admin/settings/team over /admin/settings).
  const all = sections.flatMap((s) => s.items);
  const activeHref = all
    .filter((i) => isActive(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
      {sections.map((section, idx) => (
        <div key={section.label ?? idx}>
          {section.label && (
            <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60">{section.label}</p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = item.href === activeHref;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground transition-all hover:bg-white/5 hover:text-white",
                      active && "bg-gradient-to-r from-blue-600/90 to-sky-500/70 font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_6px_18px_-8px_rgba(59,130,246,0.9)]",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function MobileNav({ sections, portalLabel, contextLabel }: { sections: NavSection[]; portalLabel: string; contextLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-lg p-2 text-foreground hover:bg-surface-muted lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </DialogTrigger>
      <SheetContent title="Navigation" className="sidebar-surface pt-safe">
        <div className="flex h-14 items-center gap-2 px-4 text-white">
          <BrandMark />
          <span className="font-semibold">ShiftPilot</span>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-sidebar-foreground">{portalLabel}</span>
        </div>
        {contextLabel && <p className="truncate px-4 pb-2 text-xs text-sidebar-foreground/80">{contextLabel}</p>}
        <SidebarNav sections={sections} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Dialog>
  );
}

/** App-style bottom tab bar on phones: the first four destinations plus "More". */
export function BottomNav({ sections, portalLabel, contextLabel }: { sections: NavSection[]; portalLabel: string; contextLabel?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = sections.flatMap((s) => s.items);
  const flagged = items.filter((i) => i.tab);
  const tabs = (flagged.length >= 2 ? flagged : items).slice(0, 4);
  const activeHref = items.filter((i) => isActive(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const moreActive = !!activeHref && !tabs.some((t) => t.href === activeHref);
  return (
    <nav aria-label="Quick navigation" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface/80 backdrop-blur-xl backdrop-saturate-150 lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map((t) => {
          const Icon = ICONS[t.icon];
          const active = t.href === activeHref;
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors", active && "text-primary")}>
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-all", active && "bg-primary-soft shadow-[0_4px_12px_-6px_rgba(37,99,235,0.8)]")}><Icon className="size-5" aria-hidden /></span>
                <span className="max-w-full truncate">{t.short ?? t.label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger className={cn("flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium text-muted-foreground", moreActive && "text-primary")}>
              <span className={cn("grid h-7 w-12 place-items-center rounded-full", moreActive && "bg-primary-soft")}><Ellipsis className="size-5" aria-hidden /></span>
              More
            </DialogTrigger>
            <SheetContent title="All pages" side="right" className="sidebar-surface pt-safe">
              <div className="flex h-14 items-center gap-2 px-4 text-white">
                <BrandMark />
                <span className="font-semibold">ShiftPilot</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-sidebar-foreground">{portalLabel}</span>
              </div>
              {contextLabel && <p className="truncate px-4 pb-2 text-xs text-sidebar-foreground/80">{contextLabel}</p>}
              <SidebarNav sections={sections} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Dialog>
        </li>
      </ul>
    </nav>
  );
}
