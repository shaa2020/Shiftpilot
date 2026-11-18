import { AppShell } from "@/components/layout/app-shell";
import { WORKER_NAV } from "@/components/layout/nav-config";
import { getMemberships, requireWorker } from "@/lib/auth/session";
import { availablePortals } from "@/lib/auth/portal";
import { getBranding } from "@/lib/branding";
import { unreadCount } from "@/lib/messages/data";

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorker();
  const [memberships, brand, unread] = await Promise.all([getMemberships(), getBranding(ctx.agencyId), unreadCount(ctx.agencyId)]);
  return (
    <AppShell
      portalLabel="Worker"
      nav={WORKER_NAV}
      user={ctx.user}
      canSwitchPortal={availablePortals(memberships).length > 1}
      brand={{ color: brand.brandColor, logoUrl: brand.logoUrl, name: brand.agencyName }}
      badges={{ "/worker/messages": unread }}
    >
      {children}
    </AppShell>
  );
}
