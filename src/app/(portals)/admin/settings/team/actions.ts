"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createInvitation } from "@/lib/invitations";
import { emailSchema } from "@/lib/validation/auth";
import { dbErrorMessage, zodErrors, type ActionState } from "@/lib/actions/state";

const inviteSchema = z.object({ email: emailSchema, role_id: z.string().uuid("Choose a role") });

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("users.manage");
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role_id: formData.get("role_id") });
  if (!parsed.success) return { errors: zodErrors(parsed.error) };
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("name").eq("id", parsed.data.role_id).single();
  const res = await createInvitation({
    agencyId: ctx.agencyId,
    agencyName: ctx.agencyName,
    inviter: { id: ctx.user.id, name: ctx.user.fullName ?? ctx.user.email },
    email: parsed.data.email,
    audience: `agency team (${role?.name ?? "staff"})`,
    input: { kind: "staff", roleId: parsed.data.role_id },
  });
  revalidatePath("/admin/settings/team");
  return res;
}

export async function revokeInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const id = z.string().uuid().parse(formData.get("id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("accepted_at", null).select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error, "The invitation could not be revoked.") };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Invitation revoked." };
}

export async function removeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStaff("users.manage");
  const id = z.string().uuid().parse(formData.get("id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_roles").delete().eq("id", id).eq("agency_id", ctx.agencyId).select("id");
  if (error || !data?.length) return { ok: false, message: dbErrorMessage(error, "The role could not be removed.") };
  revalidatePath("/admin/settings/team");
  return { ok: true, message: "Role removed." };
}
