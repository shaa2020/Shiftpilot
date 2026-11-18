import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Providers } from "@/components/layout/providers";
import { ServiceWorkerRegister } from "@/components/layout/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ShiftPilot", template: "%s · ShiftPilot" },
  description: "Staffing agency operations: clients, workers, shifts, attendance, timesheets and invoicing in one platform.",
  applicationName: "ShiftPilot",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "ShiftPilot", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0a1a2e" },
    { media: "(prefers-color-scheme: dark)", color: "#08111E" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers nonce={nonce}>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
