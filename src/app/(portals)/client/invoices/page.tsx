import type { Metadata } from "next";
import { Download, FileCode2, Receipt } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, localDate } from "@/lib/time";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/feedback";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionTabs } from "@/components/ui/detail";

export const metadata: Metadata = { title: "Invoices" };

export default async function ClientInvoicesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireClient();
  if (!ctx.capabilities.finance) return <Alert tone="warning">Your account does not have access to invoices.</Alert>;
  const { view: rawView } = await searchParams;
  const view = rawView === "paid" ? "paid" : rawView === "all" ? "all" : "open";
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, kind, invoice_number, status, issue_date, due_date, period_start, period_end, po_number, total, amount_paid, payments(paid_on, amount)")
    .eq("client_id", ctx.clientId).neq("status", "draft").order("issue_date", { ascending: false }).limit(200);
  const today = localDate(new Date());
  const all = data ?? [];
  const isOpen = (i: (typeof all)[number]) => i.kind === "invoice" && ["issued", "partially_paid"].includes(i.status);
  const open = all.filter(isOpen);
  const openAmount = open.reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0);
  const overdue = open.filter((i) => i.due_date && i.due_date < today);
  const year = today.slice(0, 4);
  const thisYear = all.filter((i) => i.kind === "invoice" && i.issue_date?.startsWith(year)).reduce((a, i) => a + Number(i.total), 0);
  const rows = view === "open" ? open : view === "paid" ? all.filter((i) => !isOpen(i)) : all;

  return (
    <>
      <PageHeader title="Invoices" description="Invoices and credit notes with payment status. Download the PDF, or the UBL e-invoice for your accounting software." />
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open balance" value={formatMoney(openAmount)} icon={Receipt} tone={openAmount > 0 ? "info" : "neutral"} />
        <StatCard label="Open invoices" value={open.length} />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : "neutral"} />
        <StatCard label={`Invoiced in ${year}`} value={formatMoney(thisYear)} />
      </section>
      <SectionTabs tabs={[{ key: "open", label: "To pay", href: "?view=open" }, { key: "paid", label: "Paid & credits", href: "?view=paid" }, { key: "all", label: "All", href: "?view=all" }]} active={view} />
      {!rows.length ? <EmptyState icon={Receipt} title={view === "open" ? "Nothing to pay" : "No invoices"} /> : (
        <ul className="space-y-2">
          {rows.map((i) => {
            const late = isOpen(i) && i.due_date && i.due_date < today;
            const remaining = Number(i.total) - Number(i.amount_paid);
            return (
              <li key={i.id} className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground"><Receipt className="size-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">{i.invoice_number}{i.kind === "credit_note" && <Badge>Credit note</Badge>}</p>
                    <p className="text-sm text-muted-foreground">
                      {i.issue_date ? formatDate(i.issue_date) : ""}
                      {i.period_start && ` · period ${formatDate(i.period_start)} – ${formatDate(i.period_end ?? i.period_start)}`}
                      {i.po_number && ` · PO ${i.po_number}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(Number(i.total))}</p>
                    <StatusBadge status={late ? "overdue" : i.status} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-sm">
                  {i.kind === "invoice" && i.due_date && <span className={late ? "font-medium text-danger" : "text-muted-foreground"}>Due {formatDate(i.due_date)}</span>}
                  {isOpen(i) && Number(i.amount_paid) > 0 && <span className="text-muted-foreground">Still to pay {formatMoney(remaining)}</span>}
                  {i.payments.length > 0 && <span className="text-muted-foreground">Paid: {i.payments.map((p) => `${formatMoney(Number(p.amount))} on ${formatDate(p.paid_on)}`).join(", ")}</span>}
                  <span className="ml-auto flex gap-2">
                    <Button asChild size="sm" variant="secondary"><a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener"><Download aria-hidden /> PDF</a></Button>
                    <Button asChild size="sm" variant="ghost"><a href={`/api/invoices/${i.id}/ubl`}><FileCode2 aria-hidden /> UBL</a></Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
