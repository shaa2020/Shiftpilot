import type { MetadataRoute } from "next";

/** Web app manifest: installable on Android, iOS/iPadOS (Add to Home Screen), Windows, macOS and ChromeOS. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/portal",
    name: "ShiftPilot",
    short_name: "ShiftPilot",
    description: "Shifts, attendance, timesheets and invoicing for staffing agencies, clients and workers.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0a1a2e",
    theme_color: "#0a1a2e",
    categories: ["business", "productivity"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "My schedule", short_name: "Schedule", url: "/worker/schedule", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Shift offers", short_name: "Offers", url: "/worker/offers", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Admin dashboard", short_name: "Dashboard", url: "/admin", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    screenshots: [
      { src: "/screenshots/wide.png", sizes: "1280x800", type: "image/png", form_factor: "wide", label: "ShiftPilot on desktop" },
      { src: "/screenshots/narrow.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "ShiftPilot on a phone" },
    ],
  };
}
