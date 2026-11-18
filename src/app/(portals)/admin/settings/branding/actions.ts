"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, fail, success, type ActionState } from "@/lib/actions/state";

const MAX_LOGO_BYTES = 256 * 1024;
const schema = z.object({
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour like #0f766e").or(z.literal("")),
  worker_welcome: z.string().trim().max(500, "Keep it under 500 characters"),
  client_welcome: z.string().trim().max(500, "Keep it under 500 characters"),
  invoice_footer: z.string().trim().max(300, "Keep it under 300 characters"),
  remove_logo: z.literal("on").optional(),
});

/** PNG or JPEG, recognised by its signature rather than the browser's claim. */
function imageType(b: Uint8Array): "image/png" | "image/jpeg" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

export async function saveBrandingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireStaff("agency.settings.manage");
  const parsed = schema.safeParse({
    brand_color: fd.get("brand_color") ?? "",
    worker_welcome: fd.get("worker_welcome") ?? "",
    client_welcome: fd.get("client_welcome") ?? "",
    invoice_footer: fd.get("invoice_footer") ?? "",
    remove_logo: fd.get("remove_logo") ?? undefined,
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return fail("Please correct the highlighted fields.", errors);
  }
  const d = parsed.data;
  const row: Record<string, string | null> = {
    agency_id: ctx.agencyId,
    brand_color: d.brand_color ? d.brand_color.toLowerCase() : null,
    worker_welcome: d.worker_welcome || null,
    client_welcome: d.client_welcome || null,
    invoice_footer: d.invoice_footer || null,
  };

  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > MAX_LOGO_BYTES) return fail("The logo is too large.", { logo: "Use a PNG or JPEG under 256 KB" });
    const bytes = new Uint8Array(await logo.arrayBuffer());
    const mime = imageType(bytes);
    if (!mime) return fail("The logo must be a PNG or JPEG image.", { logo: "Use a PNG or JPEG image" });
    row.logo_data = Buffer.from(bytes).toString("base64");
    row.logo_mime = mime;
    row.logo_updated_at = new Date().toISOString();
  } else if (d.remove_logo) {
    row.logo_data = null;
    row.logo_mime = null;
    row.logo_updated_at = null;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("agency_branding").upsert(row as never, { onConflict: "agency_id" });
  if (error) return fail(dbErrorMessage(error, "The branding could not be saved."));
  revalidatePath("/", "layout");
  return success("Branding saved. It now shows in all portals and on new invoice PDFs.");
}
