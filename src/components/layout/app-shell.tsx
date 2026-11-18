import Link from "next/link";
import { BrandMark } from "./brand";
import { SidebarNav, MobileNav, BottomNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { InstallApp } from "./install-app";
import type { NavSection } from "./nav-config";

export interface AppShellProps {
  portalLabel: string;
  contextLabel?: string;
  nav: NavSection[];
  user: { email: string; fullName: string | null };
  canSwitchPortal: boolean;
  children: React.ReactNode;
}

/** Shared responsive shell for all authenticated portals. */
export function AppShell({ portalLabel, contextLabel, nav, user, canSwitchPortal, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sidebar-surface sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-white/5 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.4)] lg:flex">
        <div className="flex h-16 items-center gap-2 px-4">
          <Link href="/portal" className="flex items-center gap-2 text-white">
            <BrandMark />
            <span className="font-semibold tracking-tight">ShiftPilot</span>
          </Link>
          <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-200">
            {portalLabel}
          </span>
        </div>
        {contextLabel && <p className="truncate px-4 pb-2 text-xs text-sidebar-foreground/80">{contextLabel}</p>}
        <SidebarNav sections={nav} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 border-b border-border/60 bg-surface/70 backdrop-blur-xl backdrop-saturate-150">
          <div className="flex h-14 items-center gap-3 px-4 lg:h-16 lg:px-6">
          <MobileNav sections={nav} portalLabel={portalLabel} contextLabel={contextLabel} />
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground lg:hidden">{contextLabel ?? portalLabel}</div>
          <div className="ml-auto flex items-center gap-1.5">
            <InstallApp className="h-8 px-2.5 text-xs" label="Install" />
            <NotificationBell />
            <UserMenu user={user} canSwitchPortal={canSwitchPortal} />
          </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-10 lg:pt-8">
          {children}
        </main>
        <BottomNav sections={nav} portalLabel={portalLabel} contextLabel={contextLabel} />
      </div>
    </div>
  );
}
