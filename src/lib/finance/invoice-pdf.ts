import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface PdfInvoice {
  kind: "invoice" | "credit_note";
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  po_number: string | null;
  notes: string | null;
  currency: string;
  subtotal: number;
  vat_total: number;
  total: number;
  billing_snapshot: {
    client: { name: string; address?: string | null; postal_code?: string | null; city?: string | null; country?: string | null; vat_number?: string | null; kvk_number?: string | null };
    agency: { name: string; address?: string | null; postal_code?: string | null; city?: string | null; vat_number?: string | null; kvk_number?: string | null; iban?: string | null; email?: string | null; phone?: string | null };
  };
  items: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; line_subtotal: number }[];
}

const NAVY = rgb(0.063, 0.141, 0.227);
const MUTED = rgb(0.392, 0.455, 0.545);

export function money(n: number, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(n);
}

/** WinAnsi-safe text for the standard PDF fonts. */
function safe(s: string) {
  return s.replace(/[^\x20-\x7E -ÿ€]/g, "?");
}

/** Generates an invoice/credit-note PDF from an issued invoice's immutable data. */
export async function renderInvoicePdf(inv: PdfInvoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${inv.invoice_number}`);
  doc.setProducer("ShiftPilot");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  const W = page.getWidth();
  let y = 790;

  const text = (p: PDFPage, s: string, x: number, yy: number, f: PDFFont = font, size = 10, color = rgb(0.09, 0.125, 0.2)) => p.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (p: PDFPage, s: string, xRight: number, yy: number, f: PDFFont = font, size = 10) => text(p, s, xRight - f.widthOfTextAtSize(safe(s), size), yy, f, size);

  const ag = inv.billing_snapshot.agency;
  const cl = inv.billing_snapshot.client;
  text(page, ag.name, 50, y, bold, 16, NAVY);
  [ag.address, [ag.postal_code, ag.city].filter(Boolean).join(" "), ag.email, ag.phone].filter(Boolean).forEach((l, i) => text(page, String(l), 50, y - 18 - i * 12, font, 9, MUTED));
  right(page, inv.kind === "credit_note" ? "CREDIT NOTE" : "INVOICE", W - 50, y, bold, 18);
  right(page, inv.invoice_number, W - 50, y - 20, font, 11);

  y = 690;
  text(page, "Bill to", 50, y, bold, 9, MUTED);
  [cl.name, cl.address, [cl.postal_code, cl.city].filter(Boolean).join(" "), cl.country, cl.vat_number ? `VAT ${cl.vat_number}` : null, cl.kvk_number ? `KvK ${cl.kvk_number}` : null]
    .filter(Boolean).forEach((l, i) => text(page, String(l), 50, y - 14 - i * 12, i === 0 ? bold : font, 10));
  const meta: [string, string][] = [
    ["Invoice date", inv.issue_date],
    ...(inv.kind === "invoice" && inv.due_date ? [["Due date", inv.due_date] as [string, string]] : []),
    ...(inv.period_start ? [["Period", `${inv.period_start} – ${inv.period_end ?? ""}`] as [string, string]] : []),
    ...(inv.po_number ? [["PO number", inv.po_number] as [string, string]] : []),
  ];
  meta.forEach(([k, v], i) => { text(page, k, 350, y - i * 14, font, 9, MUTED); right(page, v, W - 50, y - i * 14, font, 10); });

  y = 590;
  const header = () => {
    page.drawRectangle({ x: 50, y: y - 4, width: W - 100, height: 18, color: rgb(0.96, 0.97, 0.98) });
    text(page, "Description", 56, y, bold, 9);
    right(page, "Qty", 370, y, bold, 9);
    right(page, "Rate", 440, y, bold, 9);
    right(page, "VAT", 480, y, bold, 9);
    right(page, "Amount", W - 56, y, bold, 9);
    y -= 22;
  };
  header();
  for (const it of inv.items) {
    if (y < 120) {
      page = doc.addPage([595.28, 841.89]);
      y = 790;
      header();
    }
    const desc = it.description.length > 62 ? it.description.slice(0, 61) + "…" : it.description;
    text(page, desc, 56, y, font, 8.5);
    right(page, `${Number(it.quantity).toLocaleString("nl-NL", { maximumFractionDigits: 2 })} ${it.unit === "hour" ? "h" : ""}`, 370, y, font, 8.5);
    right(page, money(Number(it.unit_price), inv.currency), 440, y, font, 8.5);
    right(page, `${Number(it.vat_rate)}%`, 480, y, font, 8.5);
    right(page, money(Number(it.line_subtotal), inv.currency), W - 56, y, font, 8.5);
    y -= 15;
  }
  y -= 10;
  page.drawLine({ start: { x: 330, y: y + 8 }, end: { x: W - 50, y: y + 8 }, thickness: 0.5, color: MUTED });
  ([["Subtotal", inv.subtotal], ["VAT", inv.vat_total], ["Total", inv.total]] as [string, number][]).forEach(([k, v], i) => {
    text(page, k, 340, y - i * 16, i === 2 ? bold : font, 10);
    right(page, money(v, inv.currency), W - 56, y - i * 16, i === 2 ? bold : font, 10);
  });
  y -= 70;
  if (inv.kind === "invoice" && ag.iban) text(page, `Please pay ${money(inv.total, inv.currency)} by ${inv.due_date} to ${ag.iban} (${ag.name}), quoting ${inv.invoice_number}.`, 50, y, font, 9);
  if (inv.notes) text(page, inv.notes.slice(0, 120), 50, y - 14, font, 9, MUTED);
  text(page, [ag.vat_number ? `VAT ${ag.vat_number}` : null, ag.kvk_number ? `KvK ${ag.kvk_number}` : null].filter(Boolean).join(" · "), 50, 40, font, 8, MUTED);
  return doc.save();
}
