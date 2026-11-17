import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

/** Unread notification count for the signed-in user (RLS: own notifications only). */
export async function NotificationBell() {
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const n = count ?? 0;
  return (
    <Link href="/notifications" className="relative rounded-full p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground" aria-label={n ? `${n} unread notifications` : "Notifications"}>
      <Bell className="size-5" aria-hidden />
      {n > 0 && <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
