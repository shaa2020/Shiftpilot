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

  it("applies brand colour, logo and footer, and survives a broken logo", async () => {
    const { renderInvoicePdf } = await import("./invoice-pdf");
    const inv = {
      kind: "invoice" as const, invoice_number: "INV-2031-00002", issue_date: "2031-02-01", due_date: "2031-02-15", period_start: null, period_end: null,
      po_number: null, notes: null, currency: "EUR", subtotal: 10, vat_total: 2.1, total: 12.1,
      billing_snapshot: { client: { name: "Client" }, agency: { name: "Agency" } },
      items: [{ description: "Line", quantity: 1, unit: "hour", unit_price: 10, vat_rate: 21, line_subtotal: 10 }],
    };
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const branded = await renderInvoicePdf(inv, { color: "#0f766e", logo: { bytes: png, mime: "image/png" }, footer: "Our general terms apply. ".repeat(10) });
    const plain = await renderInvoicePdf(inv);
    expect(branded.length).toBeGreaterThan(plain.length);
    const broken = await renderInvoicePdf(inv, { logo: { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" } });
    expect(new TextDecoder().decode(broken.slice(0, 5))).toBe("%PDF-");
  });
});
