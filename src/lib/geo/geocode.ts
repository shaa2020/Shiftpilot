import "server-only";

export interface GeoPoint { latitude: number; longitude: number; source: "pdok" | "google" }

/**
 * Optional geocoding for travel-distance matching. Off unless
 * GEOCODING_PROVIDER is set:
 *  - "pdok":   PDOK Locatieserver (Dutch government, free, NL addresses only)
 *  - "google": Google Geocoding API (requires GOOGLE_MAPS_API_KEY)
 * Worker homes are geocoded at postcode level only (no street address).
 * Failures return null; the record is saved without coordinates.
 */
export async function geocode(query: { address?: string | null; postalCode?: string | null; city?: string | null; country?: string | null }): Promise<GeoPoint | null> {
  const provider = process.env.GEOCODING_PROVIDER;
  const parts = [query.address, query.postalCode, query.city].map((p) => p?.trim()).filter(Boolean) as string[];
  if (!provider || parts.length === 0) return null;
  try {
    if (provider === "pdok") {
      if (query.country && query.country.toUpperCase() !== "NL") return null;
      const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?rows=1&fl=centroide_ll,type&q=${encodeURIComponent(parts.join(" "))}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { response?: { docs?: { centroide_ll?: string }[] } };
      return parsePdokPoint(body.response?.docs?.[0]?.centroide_ll);
    }
    if (provider === "google") {
      const key = process.env.GOOGLE_MAPS_API_KEY;
      if (!key) return null;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?region=${encodeURIComponent((query.country ?? "nl").toLowerCase())}&address=${encodeURIComponent(parts.join(", "))}&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { status: string; results?: { geometry: { location: { lat: number; lng: number } } }[] };
      const loc = body.status === "OK" ? body.results?.[0]?.geometry.location : undefined;
      return loc ? { latitude: round6(loc.lat), longitude: round6(loc.lng), source: "google" } : null;
    }
  } catch {
    return null;
  }
  return null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** PDOK returns WKT "POINT(lon lat)". */
export function parsePdokPoint(wkt: string | undefined): GeoPoint | null {
  const m = wkt?.match(/^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: round6(lat), longitude: round6(lon), source: "pdok" };
}
