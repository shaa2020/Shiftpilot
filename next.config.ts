import type { NextConfig } from "next";

/**
 * Cache Components is intentionally disabled: every portal page depends on the
 * signed-in user and is protected by database RLS, so pages render at request
 * time and no per-user data is cached on the server.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Permissions-Policy",
    // Geolocation is only usable by our own origin and only after explicit opt-in in the UI.
    value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  cacheComponents: false,
  // Version-skew protection: after a new deploy, open pages reload instead of calling outdated server actions.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.NEXT_DEPLOYMENT_ID || undefined,
  experimental: {
    // Enables forbidden() / unauthorized() for authorisation failures.
    authInterrupts: true,
    // Allows CV/document uploads (validated to max 10 MB in the actions).
    serverActions: { bodySizeLimit: "11mb" },
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
