import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Target } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/time";
import { PageHeader, StatCard } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field } from "@/components/forms/field";
import { humanize } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { createLeadAction } from "./actions";

export const metadata: Metadata = { title: "CRM" };
const OPEN = ["new", "contacted", "qualified", "proposal", "negotiation"] as const;

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const ctx = await requireStaff("crm.read");
  const { mine } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("leads").select("id, company_name, contact_name, stage, estimated_monthly_value, next_follow_up_at, owner_id, source").eq("agency_id", ctx.agencyId).order("stage_changed_at", { ascending: false }).limit(500);
  if (mine) q = q.eq("owner_id", ctx.user.id);
  const [{ data: leads }, { data: industries }] = await Promise.all([q, supabase.from("industries").select("id, name").eq("agency_id", ctx.agencyId).eq("status", "active").order("sort_order")]);
  const all = leads ?? [];
  const now = new Date().toISOString();
  const won90 = all.filter((l) => l.stage === "won").length;
  const lost = all.filter((l) => l.stage === "lost").length;
  const conversion = won90 + lost > 0 ? Math.round((won90 / (won90 + lost)) * 100) : null;
  const pipelineValue = all.filter((l) => (OPEN as readonly string[]).includes(l.stage)).reduce((s, l) => s + Number(l.estimated_monthly_value ?? 0), 0);
  const overdue = all.filter((l) => l.next_follow_up_at && l.next_follow_up_at < now && (OPEN as readonly string[]).includes(l.stage));

  return (
    <>
      <PageHeader
        title="CRM"
        description="Sales pipeline from first contact to signed client."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary"><Link href={mine ? "/admin/crm" : "/admin/crm?mine=1"}>{mine ? "All leads" : "My leads"}</Link></Button>
            {ctx.can("crm.write") && (
              <Dialog>
                <DialogTrigger asChild><Button><Plus /> New lead</Button></DialogTrigger>
                <DialogContent title="New lead">
                  <ServerForm action={createLeadAction} submitLabel="Create lead" toastOnSuccess={false}>
                    <Field name="company_name" label="Company" required><Input name="company_name" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field name="contact_name" label="Contact"><Input name="contact_name" /></Field>
                      <Field name="source" label="Source"><Input name="source" placeholder="Referral, website…" /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field name="email" label="Email"><Input name="email" type="email" /></Field>
                      <Field name="phone" label="Phone"><Input name="phone" type="tel" /></Field>
                    </div>
                    <Field name="industry_id" label="Industry"><NativeSelect name="industry_id" defaultValue=""><option value="">—</option>{(industries ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field name="estimated_monthly_hours" label="Est. hours / month"><Input name="estimated_monthly_hours" type="number" min={0} /></Field>
                      <Field name="estimated_monthly_value" label="Est. value / month (€)"><Input name="estimated_monthly_value" type="number" min={0} step="0.01" /></Field>
                    </div>
                    <Field name="next_follow_up_at" label="Follow up on"><Input name="next_follow_up_at" type="datetime-local" /></Field>
                  </ServerForm>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Open pipeline (est. monthly)" value={formatMoney(pipelineValue)} icon={Target} tone="info" />
        <StatCard label="Win rate (closed leads)" value={conversion === null ? "—" : `${conversion}%`} hint={`${won90} won · ${lost} lost`} />
        <StatCard label="Overdue follow-ups" value={overdue.length} tone={overdue.length ? "warning" : "neutral"} />
      </section>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {OPEN.map((stage) => {
          const items = all.filter((l) => l.stage === stage);
          return (
            <Card key={stage} className="w-72 shrink-0">
              <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-sm">{humanize(stage)} <span className="text-muted-foreground">{items.length}</span></CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {items.length === 0 && <p className="text-xs text-muted-foreground">No leads</p>}
                {items.map((l) => (
                  <Link key={l.id} href={`/admin/crm/${l.id}`} className="block rounded-md border border-border bg-surface p-2.5 text-sm hover:border-primary/50">
                    <p className="font-medium">{l.company_name}</p>
                    <p className="text-xs text-muted-foreground">{[l.contact_name, l.source].filter(Boolean).join(" · ")}</p>
                    <div className="mt-1 flex justify-between text-xs">
                      <span className="tabular-nums">{l.estimated_monthly_value ? formatMoney(Number(l.estimated_monthly_value)) : ""}</span>
                      {l.next_follow_up_at && <span className={cn(l.next_follow_up_at < now ? "text-danger" : "text-muted-foreground")}>{formatDateTime(l.next_follow_up_at)}</span>}
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Closed: {won90} won, {lost} lost. Open a lead to see its full history.
      </p>
    </>
  );
}
