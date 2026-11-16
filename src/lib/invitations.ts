import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { invitationEmail, sendEmail } from "@/lib/integrations/email";
import { dbErrorMessage, type ActionState } from "@/lib/actions/state";
import type { Json, TablesInsert } from "@/lib/database.types";

export type InvitationInput =
  | { kind: "staff"; roleId: string }
  | { kind: "client"; clientId: string; clientRole: "client_admin" | "client_manager" | "client_viewer"; permissions: Record<string, boolean> }
  | { kind: "worker"; workerId: string };

/**
 * Creates a single-use invitation (only the SHA-256 hash of the token is
 * stored) as the current user — RLS decides whether they may invite — and
 * emails it when email delivery is configured. Never reports an unsent email
 * as sent: without a provider the one-time link is returned to the inviter.
 */
export async function createInvitation(opts: {
  agencyId: string;
  agencyName: string;
  inviter: { id: string; name: string };
  email: string;
  audience: string;
  input: InvitationInput;
}): Promise<ActionState> {
  const token = randomBytes(32).toString("base64url");
  const supabase = await createClient();
  const base = {
    agency_id: opts.agencyId,
    email: opts.email,
    token_hash: createHash("sha256").update(token).digest("hex"),
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    invited_by: opts.inviter.id,
  };
  const row: TablesInsert<"invitations"> =
    opts.input.kind === "staff"
      ? { ...base, kind: "staff", role_id: opts.input.roleId }
      : opts.input.kind === "client"
        ? { ...base, kind: "client", client_id: opts.input.clientId, client_role: opts.input.clientRole, client_permissions: opts.input.permissions as Json }
        : { ...base, kind: "worker", worker_id: opts.input.workerId };

  const { data: inv, error } = await supabase.from("invitations").insert(row).select("id").single();
  if (error || !inv) return { ok: false, message: dbErrorMessage(error, "The invitation could not be created.") };

  const link = `${publicEnv().NEXT_PUBLIC_APP_URL}/invite/${token}`;
  const mail = invitationEmail({ agencyName: opts.agencyName, inviterName: opts.inviter.name, link, audience: opts.audience });
  const result = await sendEmail({ to: opts.email, ...mail, idempotencyKey: `invitation-${inv.id}` });
  if (result.status === "sent") return { ok: true, message: `Invitation emailed to ${opts.email}.`, data: { delivery: "sent" } };
  return {
    ok: true,
    message:
      result.status === "not_configured"
        ? "Invitation created. Email delivery is awaiting configuration, so share this one-time link with the invitee yourself."
        : `Invitation created, but the email could not be sent (${result.error}). Share this one-time link with the invitee yourself.`,
    data: { delivery: result.status, link },
  };
}
