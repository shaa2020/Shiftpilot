import { notFound } from "next/navigation";
import { OpeningsList } from "../openings-list";

export default async function AgencyCareersPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(agency)) notFound();
  return <OpeningsList agencySlug={agency} />;
}
