import type { PdfInvoice } from "./invoice-pdf";

/**
 * UBL 2.1 invoice / credit note following Peppol BIS Billing 3.0 (NLCIUS
 * compatible), for import into accounting software (Exact Online, Moneybird,
 * AFAS, Twinfield, Snelstart all accept UBL). Generated from the immutable
 * billing snapshot of an issued invoice. VAT categories: S (standard) for
 * rates > 0, Z (zero-rated) for 0 % — exemptions or reverse charge must be
 * reviewed with your accountant before relying on the file.
 */
const esc = (s: string | null | undefined) => (s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const unitCode = (u: string) => (/^(h|hr|hrs|hour|hours|uur|uren)$/i.test(u.trim()) ? "HUR" : "C62");

function party(tag: string, p: { name: string; address?: string | null; postal_code?: string | null; city?: string | null; country?: string | null; vat_number?: string | null; kvk_number?: string | null; email?: string | null }) {
  return `<cac:${tag}><cac:Party>
${p.kvk_number ? `<cbc:EndpointID schemeID="0106">${esc(p.kvk_number)}</cbc:EndpointID>` : ""}
<cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>
<cac:PostalAddress>${p.address ? `<cbc:StreetName>${esc(p.address)}</cbc:StreetName>` : ""}${p.city ? `<cbc:CityName>${esc(p.city)}</cbc:CityName>` : ""}${p.postal_code ? `<cbc:PostalZone>${esc(p.postal_code)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>${esc(p.country || "NL")}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
${p.vat_number ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vat_number)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
<cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>${p.kvk_number ? `<cbc:CompanyID schemeID="0106">${esc(p.kvk_number)}</cbc:CompanyID>` : ""}</cac:PartyLegalEntity>
${p.email ? `<cac:Contact><cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail></cac:Contact>` : ""}
</cac:Party></cac:${tag}>`;
}

export function renderUbl(inv: PdfInvoice): string {
  const credit = inv.kind === "credit_note";
  const sign = credit ? -1 : 1; // credit notes are stored negative; UBL credit notes carry positive amounts
  const root = credit ? "CreditNote" : "Invoice";
  const lineTag = credit ? "CreditNoteLine" : "InvoiceLine";
  const qtyTag = credit ? "CreditedQuantity" : "InvoicedQuantity";
  const cur = inv.currency || "EUR";
  const lines = inv.items.map((i) => ({ ...i, net: sign * i.line_subtotal, qty: Math.abs(i.quantity), price: Math.abs(i.unit_price) }));

  // VAT breakdown per rate; the highest-rate group absorbs rounding so the total matches the issued invoice.
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vat_rate, (byRate.get(l.vat_rate) ?? 0) + l.net);
  const vatTotal = sign * inv.vat_total;
  const groups = [...byRate.entries()].map(([rate, taxable]) => ({ rate, taxable, tax: Math.round(taxable * rate) / 100 }));
  const diff = Math.round((vatTotal - groups.reduce((s, g) => s + g.tax, 0)) * 100) / 100;
  if (groups.length && diff !== 0) groups.reduce((a, b) => (b.rate > a.rate ? b : a)).tax += diff;
  const subtotal = sign * inv.subtotal;
  const total = sign * inv.total;
  const cat = (rate: number) => (rate > 0 ? "S" : "Z");

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
<cbc:ID>${esc(inv.invoice_number)}</cbc:ID>
<cbc:IssueDate>${inv.issue_date}</cbc:IssueDate>
${!credit && inv.due_date ? `<cbc:DueDate>${inv.due_date}</cbc:DueDate>` : ""}
<cbc:${credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>${credit ? "381" : "380"}</cbc:${credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>
${inv.notes ? `<cbc:Note>${esc(inv.notes)}</cbc:Note>` : ""}
<cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
${inv.po_number ? `<cbc:BuyerReference>${esc(inv.po_number)}</cbc:BuyerReference>` : `<cbc:BuyerReference>${esc(inv.invoice_number)}</cbc:BuyerReference>`}
${inv.period_start && inv.period_end ? `<cac:InvoicePeriod><cbc:StartDate>${inv.period_start}</cbc:StartDate><cbc:EndDate>${inv.period_end}</cbc:EndDate></cac:InvoicePeriod>` : ""}
${inv.po_number ? `<cac:OrderReference><cbc:ID>${esc(inv.po_number)}</cbc:ID></cac:OrderReference>` : ""}
${party("AccountingSupplierParty", inv.billing_snapshot.agency)}
${party("AccountingCustomerParty", inv.billing_snapshot.client)}
${inv.billing_snapshot.agency.iban ? `<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>${esc(inv.invoice_number)}</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>${esc(inv.billing_snapshot.agency.iban.replace(/\s+/g, ""))}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>` : ""}
<cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${amt(vatTotal)}</cbc:TaxAmount>
${groups.map((g) => `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${cur}">${amt(g.taxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${cur}">${amt(g.tax)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${cat(g.rate)}</cbc:ID><cbc:Percent>${g.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join("\n")}
</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="${cur}">${amt(subtotal)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="${cur}">${amt(subtotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${cur}">${amt(total)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${cur}">${amt(total)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lines.map((l, n) => `<cac:${lineTag}><cbc:ID>${n + 1}</cbc:ID><cbc:${qtyTag} unitCode="${unitCode(l.unit)}">${l.qty}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="${cur}">${amt(l.net)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${esc(l.description.slice(0, 200))}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${cat(l.vat_rate)}</cbc:ID><cbc:Percent>${l.vat_rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${cur}">${l.price.toFixed(4)}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`).join("\n")}
</${root}>
`.replace(/\n{2,}/g, "\n");
}
