import { describe, expect, it } from "vitest";
import { renderUbl } from "./ubl";
import type { PdfInvoice } from "./invoice-pdf";

const base: PdfInvoice = {
  kind: "invoice", invoice_number: "INV-2026-0001", issue_date: "2026-11-17", due_date: "2026-12-01", period_start: "2026-11-10", period_end: "2026-11-16",
  po_number: "PO <7>", notes: null, currency: "EUR", subtotal: 1200, vat_total: 252, total: 1452,
  billing_snapshot: {
    client: { name: "Hotel & Co B.V.", city: "Utrecht", postal_code: "3511AA", vat_number: "NL000099998B57", kvk_number: "12345678" },
    agency: { name: "Agency B.V.", iban: "NL91 ABNA 0417 1643 00", kvk_number: "87654321", vat_number: "NL000099999B01" },
  },
  items: [
    { description: "Cleaner — weekday hours", quantity: 40, unit: "hours", unit_price: 25, vat_rate: 21, line_subtotal: 1000 },
    { description: "Cleaner — weekend hours", quantity: 5, unit: "hours", unit_price: 40, vat_rate: 21, line_subtotal: 200 },
  ],
};

describe("UBL export", () => {
  it("produces a Peppol BIS 3 invoice whose totals match the issued invoice", () => {
    const xml = renderUbl(base);
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>");
    expect(xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">252.00</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">1452.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="HUR">40</cbc:InvoicedQuantity>');
    expect(xml).toContain("<cbc:ID>NL91ABNA0417164300</cbc:ID>");
    expect(xml.match(/<cac:InvoiceLine>/g)).toHaveLength(2);
  });
  it("escapes XML and renders credit notes with positive amounts", () => {
    const xml = renderUbl({ ...base, kind: "credit_note", subtotal: -100, vat_total: -21, total: -121, items: [{ description: "Correction", quantity: -4, unit: "hours", unit_price: 25, vat_rate: 21, line_subtotal: -100 }] });
    expect(xml).toContain("<CreditNote ");
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>');
    expect(xml).toContain("Hotel &amp; Co B.V.");
    expect(xml).toContain("PO &lt;7&gt;");
    expect(xml).not.toContain("<DueDate>");
  });
  it("splits VAT per rate and keeps the issued VAT total exactly", () => {
    const xml = renderUbl({ ...base, subtotal: 300.01, vat_total: 21.01, total: 321.02, items: [
      { description: "A", quantity: 1, unit: "pcs", unit_price: 100.01, vat_rate: 21, line_subtotal: 100.01 },
      { description: "B", quantity: 1, unit: "pcs", unit_price: 200, vat_rate: 0, line_subtotal: 200 },
    ] });
    expect(xml).toContain('<cbc:TaxableAmount currencyID="EUR">100.01</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">21.01</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:TaxableAmount currencyID="EUR">200.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>');
    expect(xml).toContain("<cbc:ID>Z</cbc:ID><cbc:Percent>0</cbc:Percent>");
    expect(xml).toContain('<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">21.01</cbc:TaxAmount>');
  });
});
