import { AppShell } from "@/components/layout/app-shell";
import { ADMIN_NAV, filterNav } from "@/components/layout/nav-config";
import { getMemberships, requireStaff } from "@/lib/auth/session";
import { availablePortals } from "@/lib/auth/portal";
import { getBranding } from "@/lib/branding";
import { unreadCount } from "@/lib/messages/data";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const canMessage = ctx.permissions.has("shifts.read");
  const [memberships, brand, unread] = await Promise.all([
    getMemberships(),
    getBranding(ctx.agencyId),
    canMessage ? unreadCount(ctx.agencyId) : Promise.resolve(0),
  ]);
  return (
    <AppShell
      portalLabel="Admin HQ"
      contextLabel={ctx.agencyName}
      nav={filterNav(ADMIN_NAV, ctx.permissions)}
      user={ctx.user}
      canSwitchPortal={availablePortals(memberships).length > 1}
      brand={{ color: brand.brandColor, logoUrl: brand.logoUrl, name: ctx.agencyName }}
      badges={{ "/admin/messages": unread }}
    >
      {children}
    </AppShell>
  );
}
