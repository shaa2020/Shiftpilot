import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { ListFilters } from "@/components/ui/list-filters";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { markPaidAction, reviewPurchaseInvoiceAction } from "./actions";

export const metadata: Metadata = { title: "Freelancer invoices" };
const STATUSES = ["submitted", "under_review", "approved", "rejected", "scheduled", "paid"];

export default async function PurchaseInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("finance.read") && !ctx.can("purchase_invoices.approve")) {
    const { forbidden } = await import("next/navigation");
    forbidden();
  }
  const { status } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("freelancer_invoices").select("id, supplier_invoice_number, invoice_date, period_start, period_end, subtotal, vat_amount, total, status, payee_iban, payee_name, review_note, matched_minutes, freelancer_businesses(trade_name, kvk_number), workers(first_name, last_name), freelancer_invoice_lines(matched)").eq("agency_id", ctx.agencyId).order("created_at", { ascending: false }).limit(300);
  q = status && STATUSES.includes(status) ? q.eq("status", status) : q.in("status", ["submitted", "under_review", "approved", "scheduled"]);
  const { data } = await q;
  return (
    <>
      <PageHeader title="Freelancer invoices" description="Purchase invoices from freelancers, matched against approved timesheets and agreed rates. Separate from payroll." />
      <ListFilters showSearch={false} selects={[{ name: "status", label: "Status", value: status, options: STATUSES.map((s) => [s, humanize(s)]) }]} />
      <Card className="overflow-hidden">
        {!data?.length ? <EmptyState icon={FileText} title="No invoices" className="m-5" /> : (
          <Table>
            <THead><tr><TH>Freelancer</TH><TH>Invoice</TH><TH>Period</TH><TH className="text-right">Total</TH><TH>Matching</TH><TH>Status</TH><TH className="text-right">Actions</TH></tr></THead>
            <TBody>
              {data.map((f) => {
                const unmatched = f.freelancer_invoice_lines.filter((l) => !l.matched).length;
                return (
                  <TR key={f.id}>
                    <TD>{f.workers?.first_name} {f.workers?.last_name}<p className="text-xs text-muted-foreground">{f.freelancer_businesses?.trade_name}{f.freelancer_businesses?.kvk_number ? ` · KvK ${f.freelancer_businesses.kvk_number}` : ""}</p></TD>
                    <TD>{f.supplier_invoice_number}<p className="text-xs text-muted-foreground">{f.invoice_date} · {f.payee_iban}</p></TD>
                    <TD className="text-muted-foreground">{f.period_start} – {f.period_end}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(Number(f.total))}<p className="text-xs text-muted-foreground">VAT {formatMoney(Number(f.vat_amount))}</p></TD>
                    <TD className={unmatched ? "text-danger" : "text-success"}>{unmatched ? `${unmatched} unmatched` : `All ${f.freelancer_invoice_lines.length} line(s) matched`}</TD>
                    <TD><StatusBadge status={f.status} />{f.review_note && <p className="text-xs text-muted-foreground">{f.review_note}</p>}</TD>
                    <TD className="space-x-1 whitespace-nowrap text-right">
                      {ctx.can("purchase_invoices.approve") && ["submitted", "under_review"].includes(f.status) && (
                        <>
                          <ConfirmAction action={reviewPurchaseInvoiceAction} fields={{ id: f.id, approve: "true" }} title="Approve for payment?" confirmLabel="Approve" variant="soft">Approve</ConfirmAction>
                          <ConfirmAction action={reviewPurchaseInvoiceAction} fields={{ id: f.id, approve: "false" }} title="Reject invoice?" withReason="Reason" variant="ghost" destructive confirmLabel="Reject">Reject</ConfirmAction>
                        </>
                      )}
                      {ctx.can("payments.record") && ["approved", "scheduled"].includes(f.status) && <ConfirmAction action={markPaidAction} fields={{ id: f.id }} title="Mark as paid today?" withReason="Payment reference" reasonOptional confirmLabel="Mark paid">Mark paid</ConfirmAction>}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
