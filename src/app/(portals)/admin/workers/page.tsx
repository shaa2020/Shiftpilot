import type { Metadata } from "next";
import Link from "next/link";
import { HardHat, Plus } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { ListFilters, ilikePattern } from "@/components/ui/list-filters";

export const metadata: Metadata = { title: "Workers" };

const STATUSES: [string, string][] = [
  ["invited", "Invited"], ["onboarding", "Onboarding"], ["pending_review", "Pending review"], ["active", "Active"],
  ["suspended", "Suspended"], ["inactive", "Inactive"], ["archived", "Archived"],
];

export default async function WorkersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; type?: string }> }) {
  const ctx = await requireStaff("workers.read");
  const { q, status, type } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("workers")
    .select("id, worker_number, first_name, last_name, email, city, engagement_type, status, worker_skills(count)")
    .eq("agency_id", ctx.agencyId)
    .order("last_name")
    .limit(300);
  if (status && STATUSES.some(([s]) => s === status)) query = query.eq("status", status as "active");
  else query = query.neq("status", "archived");
  if (type === "employee" || type === "freelancer") query = query.eq("engagement_type", type);
  if (q) {
    const p = ilikePattern(q);
    query = query.or(`first_name.ilike.${p},last_name.ilike.${p},email.ilike.${p},worker_number.ilike.${p},city.ilike.${p}`);
  }
  const { data: workers, error } = await query;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Workers"
        description="Agency employees and independent freelancers."
        actions={ctx.can("workers.write") && <Button asChild><Link href="/admin/workers/new"><Plus /> New worker</Link></Button>}
      />
      <ListFilters
        q={q}
        placeholder="Search name, email, number or city"
        selects={[
          { name: "status", label: "Status", value: status, options: STATUSES },
          { name: "type", label: "Pathway", value: type, options: [["employee", "Employees"], ["freelancer", "Freelancers"]] },
        ]}
      />
      <Card className="overflow-hidden">
        {!workers?.length ? (
          <EmptyState icon={HardHat} title={q || status || type ? "No workers match your filters" : "No workers yet"} className="m-5" />
        ) : (
          <Table>
            <THead><tr><TH>Worker</TH><TH>Pathway</TH><TH>City</TH><TH>Skills</TH><TH>Status</TH></tr></THead>
            <TBody>
              {workers.map((w) => (
                <TR key={w.id}>
                  <TD>
                    <Link href={`/admin/workers/${w.id}`} className="font-medium text-primary hover:underline">{w.first_name} {w.last_name}</Link>
                    <p className="text-xs text-muted-foreground">{w.worker_number} · {w.email}</p>
                  </TD>
                  <TD><Badge tone={w.engagement_type === "employee" ? "info" : "neutral"}>{w.engagement_type === "employee" ? "Employee" : "Freelancer"}</Badge></TD>
                  <TD className="text-muted-foreground">{w.city ?? "—"}</TD>
                  <TD className="tabular-nums">{w.worker_skills?.[0]?.count ?? 0}</TD>
                  <TD><StatusBadge status={w.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
