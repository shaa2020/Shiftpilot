import type { Metadata } from "next";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { StatusBadge, humanize } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Pricing" };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function ClientPricingPage() {
  const ctx = await requireClient();
  if (!ctx.capabilities.finance) return <Alert tone="warning">Your account does not have access to pricing.</Alert>;
  const supabase = await createClient();
  // RLS shows only non-draft rate cards of this client — never wages or margins.
  const { data: cards } = await supabase.from("client_rate_cards").select("id, name, status, effective_from, effective_to, currency, client_rate_rules(rule_kind, hourly_rate, multiplier, days_of_week, time_from, time_to, job_positions(name))").eq("client_id", ctx.clientId).order("effective_from", { ascending: false });
  return (
    <>
      <PageHeader title="Contracted pricing" description="Hourly rates agreed with the agency (excluding VAT)." />
      {!cards?.length ? <EmptyState title="No rate cards yet" /> : cards.map((c) => (
        <Card key={c.id} className="mb-4">
          <CardHeader><CardTitle className="flex items-center gap-2">{c.name} <StatusBadge status={c.status} /></CardTitle><CardDescription>{c.effective_from} → {c.effective_to ?? "open-ended"}</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {c.client_rate_rules.map((r, i) => (
                <li key={i} className="flex justify-between py-2">
                  <span>{humanize(r.rule_kind)} · {r.job_positions?.name ?? "all positions"}{r.days_of_week ? ` · ${r.days_of_week.map((d) => DAYS[d]).join("/")}` : ""}{r.time_from ? ` · ${r.time_from.slice(0, 5)}–${r.time_to?.slice(0, 5)}` : ""}</span>
                  <span className="tabular-nums">{r.hourly_rate != null ? `${formatMoney(Number(r.hourly_rate))}/h` : `${Math.round(Number(r.multiplier) * 100)}% of base rate`}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
