import type { Metadata } from "next";
import { OpeningsList } from "./openings-list";

export const metadata: Metadata = { title: "Careers", description: "Open positions" };

export default async function CareersPage() {
  return <OpeningsList />;
}
