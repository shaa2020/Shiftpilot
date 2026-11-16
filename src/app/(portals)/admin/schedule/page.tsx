import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/feedback";
import { ScheduleCalendar } from "./calendar";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const ctx = await requireStaff("shifts.read");
  const supabase = await createClient();
  const [{ data: clients }, { data: locations }, { data: positions }, { data: workers }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("agency_id", ctx.agencyId).neq("status", "archived").order("name"),
    supabase.from("client_locations").select("id, name, client_id").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    supabase.from("job_positions").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("name"),
    ctx.can("workers.read") ? supabase.from("workers").select("id, first_name, last_name").eq("agency_id", ctx.agencyId).eq("status", "active").order("last_name") : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
  ]);
  return (
    <>
      <PageHeader title="Schedule" description="Drag a shift to reschedule it. The database refuses moves that would double-book an assigned worker." />
      <ScheduleCalendar
        clients={clients ?? []}
        locations={locations ?? []}
        positions={positions ?? []}
        workers={(workers ?? []).map((w) => ({ id: w.id, name: `${w.first_name} ${w.last_name}` }))}
        canEdit={ctx.can("shifts.write")}
      />
    </>
  );
}
