import type { Metadata } from "next";
import Link from "next/link";
import { CarFront, DoorOpen, MapPin, MessageSquare, Navigation, UserRound } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { directionsUrl } from "@/lib/maps";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { DetailRow } from "@/components/worker/shift-ui";

export const metadata: Metadata = { title: "Locations" };

export default async function ClientLocationsPage() {
  const ctx = await requireClient();
  const supabase = await createClient();
  // RLS: only locations this user may see (location-restricted users see their own).
  const { data } = await supabase
    .from("client_locations")
    .select("id, name, address_line1, postal_code, city, latitude, longitude, arrival_instructions, parking_info, site_contact_name, site_contact_phone, status")
    .eq("client_id", ctx.clientId).order("name");
  return (
    <>
      <PageHeader title="Locations" description="Your sites and what workers are told on arrival. Something out of date? Ask the agency to change it." />
      {!data?.length ? <EmptyState icon={MapPin} title="No locations available to your account" /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.map((l) => (
            <Card key={l.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate">{l.name}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{[l.address_line1, [l.postal_code, l.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
                </div>
                {l.status !== "active" && <StatusBadge status={l.status} />}
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailRow icon={DoorOpen} label="Arrival instructions for workers">{l.arrival_instructions ? <p className="whitespace-pre-line">{l.arrival_instructions}</p> : <span className="text-muted-foreground">None yet</span>}</DetailRow>
                <DetailRow icon={CarFront} label="Parking & travel">{l.parking_info ? <p className="whitespace-pre-line">{l.parking_info}</p> : <span className="text-muted-foreground">None yet</span>}</DetailRow>
                <DetailRow icon={UserRound} label="Contact on site">
                  {l.site_contact_name ? <p>{l.site_contact_name}{l.site_contact_phone && <> · <a className="text-primary hover:underline" href={`tel:${l.site_contact_phone}`}>{l.site_contact_phone}</a></>}</p> : <span className="text-muted-foreground">Not set</span>}
                </DetailRow>
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button asChild size="sm" variant="secondary"><a href={directionsUrl(l)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> Map</a></Button>
                  <Button asChild size="sm" variant="ghost"><Link href={`/client/messages?subject=${encodeURIComponent(`Update location: ${l.name}`)}`}><MessageSquare aria-hidden /> Ask for a change</Link></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
