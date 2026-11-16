import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { ListFilters, ilikePattern } from "@/components/ui/list-filters";

export const metadata: Metadata = { title: "Clients" };

const STATUSES: [string, string][] = [["onboarding", "Onboarding"], ["active", "Active"], ["on_hold", "On hold"], ["archived", "Archived"]];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await requireStaff("clients.read");
  const { q, status } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("id, name, kvk_number, status, billing_city, industries(name), client_locations(count)")
    .eq("agency_id", ctx.agencyId)
    .order("name")
    .limit(200);
  if (status && STATUSES.some(([s]) => s === status)) query = query.eq("status", status as "active");
  else query = query.neq("status", "archived");
  if (q) query = query.or(`name.ilike.${ilikePattern(q)},kvk_number.ilike.${ilikePattern(q)}`);
  const { data: clients, error } = await query;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Business clients, their locations, contacts, contracts and portal users."
        actions={ctx.can("clients.write") && (
          <Button asChild><Link href="/admin/clients/new"><Plus /> New client</Link></Button>
        )}
      />
      <ListFilters q={q} placeholder="Search by name or KvK number" selects={[{ name: "status", label: "Status", value: status, options: STATUSES }]} />
      <Card className="overflow-hidden">
        {!clients || clients.length === 0 ? (
          <EmptyState icon={Building2} title={q || status ? "No clients match your filters" : "No clients yet"} className="m-5" description={!q && !status ? "Create your first client to start receiving staffing requests." : undefined} />
        ) : (
          <Table>
            <THead><tr><TH>Client</TH><TH>Industry</TH><TH>City</TH><TH>Locations</TH><TH>Status</TH></tr></THead>
            <TBody>
              {clients.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link href={`/admin/clients/${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                    {c.kvk_number && <p className="text-xs text-muted-foreground">KvK {c.kvk_number}</p>}
                  </TD>
                  <TD className="text-muted-foreground">{c.industries?.name ?? "—"}</TD>
                  <TD className="text-muted-foreground">{c.billing_city ?? "—"}</TD>
                  <TD className="tabular-nums">{c.client_locations?.[0]?.count ?? 0}</TD>
                  <TD><StatusBadge status={c.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
