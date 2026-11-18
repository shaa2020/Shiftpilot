import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadInvoiceBranding, loadInvoiceForPdf } from "@/lib/finance/load";
import { renderInvoicePdf } from "@/lib/finance/invoice-pdf";

/** Issued invoice PDF, generated from immutable data. Access is decided by RLS (finance staff or the client's finance users). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  const inv = await loadInvoiceForPdf(id);
  if (!inv) return new NextResponse("Not found", { status: 404 });
  const bytes = await renderInvoicePdf(inv, await loadInvoiceBranding(inv.agency_id));
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.invoice_number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
