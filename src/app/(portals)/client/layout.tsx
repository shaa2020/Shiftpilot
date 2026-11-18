import { AppShell } from "@/components/layout/app-shell";
import { clientNav } from "@/components/layout/nav-config";
import { getMemberships, requireClient } from "@/lib/auth/session";
import { availablePortals } from "@/lib/auth/portal";
import { getBranding } from "@/lib/branding";
import { unreadCount } from "@/lib/messages/data";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireClient();
  const [memberships, brand, unread] = await Promise.all([getMemberships(), getBranding(ctx.agencyId), unreadCount(ctx.agencyId)]);
  return (
    <AppShell
      portalLabel="Client"
      contextLabel={ctx.clientName}
      nav={clientNav(ctx.capabilities)}
      user={ctx.user}
      canSwitchPortal={availablePortals(memberships).length > 1}
      brand={{ color: brand.brandColor, logoUrl: brand.logoUrl, name: brand.agencyName }}
      badges={{ "/client/messages": unread }}
    >
      {children}
    </AppShell>
  );
}
