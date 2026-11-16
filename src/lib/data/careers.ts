import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/** Anonymous client for public pages (RLS: published openings only). */
function anon() {
  const env = publicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

export async function listOpenings(agencySlug?: string) {
  const { data, error } = await anon().rpc("public_job_openings", { p_agency_slug: agencySlug });
  if (error) return { openings: [], error: true as const };
  return { openings: data ?? [], error: false as const };
}

export async function getOpening(agencySlug: string, jobSlug: string) {
  const { data } = await anon().rpc("public_job_openings", { p_agency_slug: agencySlug, p_job_slug: jobSlug });
  return data?.[0] ?? null;
}
