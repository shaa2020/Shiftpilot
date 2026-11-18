"use server";
import { geocode } from "@/lib/geo/geocode";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createInvitation } from "@/lib/invitations";
import { dbErrorMessage, formObject, zodErrors, type ActionState } from "@/lib/actions/state";
import { clientInviteSchema, clientSchema, contactSchema, contractSchema, locationSchema } from "@/lib/validation/clients";

const id = z.string().uuid();

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("clients.write");
  const parsed = clientSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ ...parsed.data, agency_id: ctx.agencyId, account_manager_id: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) return { message: dbErrorMessage(error) };
  redirect(`/admin/clients/${data.id}`);
}

export async function updateClientAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("clients.write");
  const parsed = clientSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").update(parsed.data).eq("id", id.parse(clientId)).select("id");
  if (error || !data?.length) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: "Client saved." };
}

export async function setClientArchivedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("clients.archive");
  const clientId = id.parse(formData.get("id"));
  const archive = formData.get("archive") === "true";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ status: archive ? "archived" : "active" })
    .eq("id", clientId)
    .select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: archive ? "Client archived." : "Client restored." };
}

export async function addLocationAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("clients.write");
  const parsed = locationSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const d = parsed.data;
  const point = d.latitude == null || d.longitude == null ? await geocode({ address: d.address_line1, postalCode: d.postal_code, city: d.city, country: d.country_code }) : null;
  const { error } = await supabase.from("client_locations").insert({ ...d, ...(point ? { latitude: point.latitude, longitude: point.longitude } : {}), agency_id: ctx.agencyId, client_id: id.parse(clientId) });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: "Location added." };
}

export async function setLocationStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("clients.write");
  const locId = id.parse(formData.get("id"));
  const status = z.enum(["active", "inactive"]).parse(formData.get("status"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_locations").update({ status }).eq("id", locId).select("client_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${data[0].client_id}`);
  return { ok: true, message: status === "active" ? "Location reactivated." : "Location deactivated." };
}

export async function addContactAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("clients.write");
  const parsed = contactSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  if (parsed.data.is_primary) {
    await supabase.from("client_contacts").update({ is_primary: false }).eq("client_id", clientId).eq("is_primary", true);
  }
  const { error } = await supabase.from("client_contacts").insert({ ...parsed.data, agency_id: ctx.agencyId, client_id: id.parse(clientId) });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: "Contact added." };
}

export async function deleteContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("clients.write");
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_contacts").delete().eq("id", id.parse(formData.get("id"))).select("client_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${data[0].client_id}`);
  return { ok: true, message: "Contact removed." };
}

export async function inviteClientUserAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("clients.write");
  const parsed = clientInviteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name").eq("id", id.parse(clientId)).single();
  if (!client) return { ok: false, message: "Client not found." };
  const { email, client_role, ...permissions } = parsed.data;
  const res = await createInvitation({
    agencyId: ctx.agencyId,
    agencyName: ctx.agencyName,
    inviter: { id: ctx.user.id, name: ctx.user.fullName ?? ctx.user.email },
    email,
    audience: `client portal for ${client.name}`,
    input: { kind: "client", clientId, clientRole: client_role, permissions },
  });
  revalidatePath(`/admin/clients/${clientId}`);
  return res;
}

export async function updateMembershipAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("clients.write");
  const membershipId = id.parse(formData.get("id"));
  const field = z.enum(["can_request_staff", "can_approve_timesheets", "can_view_finance", "can_manage_users", "status"]).parse(formData.get("field"));
  const value = String(formData.get("value"));
  const supabase = await createClient();
  const patch = field === "status" ? { status: z.enum(["active", "inactive"]).parse(value) } : { [field]: value === "true" };
  const { data, error } = await supabase.from("client_memberships").update(patch).eq("id", membershipId).select("client_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${data[0].client_id}`);
  return { ok: true, message: "Access updated." };
}

export async function addContractAction(clientId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("clients.write");
  const parsed = contractSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please correct the highlighted fields." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_contracts")
    .insert({ ...parsed.data, agency_id: ctx.agencyId, client_id: id.parse(clientId), created_by: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, message: "Contract draft created." };
}

export async function setContractStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff("clients.write");
  const contractId = id.parse(formData.get("id"));
  const status = z.enum(["pending_signature", "active", "expired", "terminated"]).parse(formData.get("status"));
  const signedBy = String(formData.get("reason") ?? "").trim();
  const supabase = await createClient();
  const patch =
    status === "active"
      ? { status, signed_at: new Date().toISOString(), signed_by_name: signedBy || null }
      : { status };
  const { data, error } = await supabase.from("client_contracts").update(patch).eq("id", contractId).select("client_id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath(`/admin/clients/${data[0].client_id}`);
  return { ok: true, message: "Contract updated." };
}
