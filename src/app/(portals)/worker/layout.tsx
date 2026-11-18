import { AppShell } from "@/components/layout/app-shell";
import { WORKER_NAV } from "@/components/layout/nav-config";
import { getMemberships, requireWorker } from "@/lib/auth/session";
import { availablePortals } from "@/lib/auth/portal";
import { getBranding } from "@/lib/branding";
import { unreadCount } from "@/lib/messages/data";
import { createClient } from "@/lib/supabase/server";

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const [memberships, brand, unread, inv, asg] = await Promise.all([
    getMemberships(),
    getBranding(ctx.agencyId),
    unreadCount(ctx.agencyId),
    supabase.from("shift_invitations").select("id", { count: "exact", head: true }).eq("worker_id", ctx.workerId).eq("status", "pending"),
    supabase.from("shift_assignments").select("id", { count: "exact", head: true }).eq("worker_id", ctx.workerId).eq("status", "invited"),
  ]);
  return (
    <AppShell
      portalLabel="Worker"
      nav={WORKER_NAV}
      user={ctx.user}
      canSwitchPortal={availablePortals(memberships).length > 1}
      brand={{ color: brand.brandColor, logoUrl: brand.logoUrl, name: brand.agencyName }}
      badges={{ "/worker/messages": unread, "/worker/offers": (inv.count ?? 0) + (asg.count ?? 0) }}
    >
      {children}
    </AppShell>
  );
}
