import { Megaphone, Pin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";

/**
 * The agency's welcome message and current announcements for this portal.
 * Row-level security limits announcements to the viewer's audience.
 */
export async function PortalFeed({ agencyId, welcome, agencyName }: { agencyId: string; welcome: string | null; agencyName: string | null }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("id, title, body, pinned, published_at")
    .eq("agency_id", agencyId)
    .lte("published_at", new Date().toISOString())
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(3);
  const items = data ?? [];
  if (!welcome && items.length === 0) return null;
  return (
    <section aria-label="From your agency" className="mb-5 space-y-3">
      {welcome && (
        <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary-soft to-surface p-4 shadow-[var(--shadow-card)]">
          {agencyName && <p className="text-xs font-medium uppercase tracking-wider text-primary-soft-foreground">{agencyName}</p>}
          <p className="mt-1 whitespace-pre-line text-sm text-foreground">{welcome}</p>
        </div>
      )}
      {items.map((a) => (
        <article key={a.id} className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <header className="flex items-start gap-2">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
              {a.pinned ? <Pin className="size-3.5" aria-label="Pinned" /> : <Megaphone className="size-3.5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold leading-snug">{a.title}</h2>
              <p className="text-xs text-muted-foreground">{formatDate(a.published_at)}</p>
            </div>
          </header>
          <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">{a.body}</p>
        </article>
      ))}
    </section>
  );
}
