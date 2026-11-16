import Link from "next/link";
import { Briefcase, MapPin } from "lucide-react";
import { listOpenings } from "@/lib/data/careers";
import { EmptyState } from "@/components/ui/feedback";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export async function OpeningsList({ agencySlug }: { agencySlug?: string }) {
  const { openings, error } = await listOpenings(agencySlug);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{agencySlug && openings[0] ? `Work with ${openings[0].agency_name}` : "Open positions"}</h1>
        <p className="mt-1 text-muted-foreground">Apply in a few minutes. We respond to every application.</p>
      </div>
      {error && <Alert tone="warning">Job openings could not be loaded right now. Please try again later.</Alert>}
      {!error && openings.length === 0 && <EmptyState icon={Briefcase} title="No open positions at the moment" description="Please check back soon." />}
      <ul className="grid gap-3">
        {openings.map((o) => (
          <li key={o.id}>
            <Link href={`/recruitment/${o.agency_slug}/${o.slug}`} className="block rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-primary/50">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{o.title}</h2>
                  <p className="text-sm text-muted-foreground">{o.agency_name}</p>
                </div>
                <div className="flex gap-1">{o.engagement_types.map((e) => <Badge key={e} tone="info">{e === "employee" ? "Employment" : "Freelance"}</Badge>)}</div>
              </div>
              <p className="mt-2 flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                {o.location_city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{o.location_city}</span>}
                {o.hours_indication && <span>{o.hours_indication}</span>}
                {o.pay_indication && <span>{o.pay_indication}</span>}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
