import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/session";
import { getBranding } from "@/lib/branding";
import { PageHeader } from "@/components/ui/feedback";
import { BrandingForm } from "./branding-form";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingPage() {
  const ctx = await requireStaff("agency.settings.manage");
  const b = await getBranding(ctx.agencyId);
  return (
    <>
      <PageHeader
        title="Branding"
        description="Your logo, colour and welcome messages — shown to your team, workers and clients, and on invoice PDFs."
      />
      <BrandingForm
        agencyName={ctx.agencyName}
        initial={{
          brandColor: b.brandColor,
          logoUrl: b.logoUrl,
          workerWelcome: b.workerWelcome ?? "",
          clientWelcome: b.clientWelcome ?? "",
          invoiceFooter: b.invoiceFooter ?? "",
        }}
      />
    </>
  );
}
