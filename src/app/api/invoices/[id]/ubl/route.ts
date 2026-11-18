import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadInvoiceForPdf } from "@/lib/finance/load";
import { renderUbl } from "@/lib/finance/ubl";

/** UBL 2.1 (Peppol BIS 3) e-invoice for accounting import. Access decided by RLS, like the PDF. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  const inv = await loadInvoiceForPdf(id);
  if (!inv) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(renderUbl(inv), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${inv.invoice_number}.xml"`, "Cache-Control": "private, no-store" },
  });
}
