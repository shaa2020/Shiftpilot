import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
export { brandCss, readableOn } from "./branding-css";

export interface Branding {
  agencyId: string;
  agencyName: string | null;
  brandColor: string | null;
  logoUrl: string | null;
  workerWelcome: string | null;
  clientWelcome: string | null;
  invoiceFooter: string | null;
}

/** Agency branding as the signed-in user may see it (RLS: any agency participant). */
export const getBranding = cache(async (agencyId: string): Promise<Branding> => {
  const supabase = await createClient();
  const [{ data }, { data: agencies }] = await Promise.all([
    supabase
      .from("agency_branding")
      .select("brand_color, logo_updated_at, worker_welcome, client_welcome, invoice_footer")
      .eq("agency_id", agencyId)
      .maybeSingle(),
    supabase.rpc("my_agencies"),
  ]);
  return {
    agencyId,
    agencyName: agencies?.find((a) => a.agency_id === agencyId)?.name ?? null,
    brandColor: data?.brand_color ?? null,
    logoUrl: data?.logo_updated_at ? logoUrl(agencyId, data.logo_updated_at) : null,
    workerWelcome: data?.worker_welcome ?? null,
    clientWelcome: data?.client_welcome ?? null,
    invoiceFooter: data?.invoice_footer ?? null,
  };
});

export function logoUrl(agencyId: string, updatedAt: string) {
  return `/api/branding/logo/${agencyId}?v=${new Date(updatedAt).getTime().toString(36)}`;
}
