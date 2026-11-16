/** Google Maps directions link (no API key needed; opens the user's maps app). */
export function directionsUrl(loc: { latitude?: number | null; longitude?: number | null; address_line1?: string | null; postal_code?: string | null; city?: string | null }) {
  const destination = loc.latitude != null && loc.longitude != null
    ? `${loc.latitude},${loc.longitude}`
    : [loc.address_line1, loc.postal_code, loc.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
