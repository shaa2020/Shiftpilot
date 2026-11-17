import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

describe("invoice PDF", () => {
  it("renders a valid multi-page PDF including euro amounts", async () => {
    const { renderInvoicePdf } = await import("./invoice-pdf");
    const bytes = await renderInvoicePdf({
      kind: "invoice", invoice_number: "INV-2031-00001", issue_date: "2031-02-01", due_date: "2031-02-15", period_start: "2031-01-01", period_end: "2031-01-31",
      po_number: "PO-9", notes: null, currency: "EUR", subtotal: 225, vat_total: 47.25, total: 272.25,
      billing_snapshot: { client: { name: "Client Ł B.V.", city: "Utrecht" }, agency: { name: "Agency", iban: "NL91ABNA0417164300" } },
      items: Array.from({ length: 60 }, (_, i) => ({ description: `Line ${i} · Schoonmaker`, quantity: 7.5, unit: "hour", unit_price: 30, vat_rate: 21, line_subtotal: 225 })),
    });
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
