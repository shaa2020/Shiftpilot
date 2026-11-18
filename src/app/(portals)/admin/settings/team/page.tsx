import type { Metadata } from "next";
import { Mail, Users } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { InvitationForm } from "@/components/forms/invitation-result";
import { inviteStaffAction, removeRoleAction, revokeInvitationAction } from "./actions";

export const metadata: Metadata = { title: "Team & access" };

export default async function TeamPage() {
  const ctx = await requireStaff("users.manage");
  const supabase = await createClient();
  const [assignments, invitations, roles] = await Promise.all([
    supabase
      .from("user_roles")
      .select("id, created_at, user_id, roles(key, name), profiles!user_roles_user_id_fkey(full_name, email)")
      .eq("agency_id", ctx.agencyId)
      .order("created_at"),
    supabase
      .from("invitations")
      .select("id, email, created_at, expires_at, roles(name)")
      .eq("agency_id", ctx.agencyId)
      .eq("kind", "staff")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("roles").select("id, key, name, is_system").or(`agency_id.is.null,agency_id.eq.${ctx.agencyId}`).order("is_system", { ascending: false }).order("name"),
  ]);

  const isOwner = ctx.roles.includes("agency_owner");
  const roleOptions = (roles.data ?? []).filter((r) => isOwner || r.key !== "agency_owner");

  // Group role assignments per person.
  const people = new Map<string, { name: string; email: string; roles: { id: string; name: string; key: string }[] }>();
  for (const a of assignments.data ?? []) {
    const p = people.get(a.user_id) ?? { name: a.profiles?.full_name ?? "", email: a.profiles?.email ?? "", roles: [] };
    p.roles.push({ id: a.id, name: a.roles?.name ?? "", key: a.roles?.key ?? "" });
    people.set(a.user_id, p);
  }
  const pending = (invitations.data ?? []).filter((i) => new Date(i.expires_at) > new Date());

  return (
    <>
      <PageHeader title="Team & access" description="Invite agency staff and manage their roles. Clients and workers are invited from their own records." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Staff</CardTitle>
              <CardDescription>{people.size} {people.size === 1 ? "person has" : "people have"} access to this agency.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {people.size === 0 ? (
                <EmptyState icon={Users} title="No staff yet" className="mx-5 mb-5" />
              ) : (
                <Table>
                  <THead>
                    <tr><TH>Person</TH><TH>Roles</TH></tr>
                  </THead>
                  <TBody>
                    {[...people.entries()].map(([userId, p]) => (
                      <TR key={userId}>
                        <TD>
                          <p className="font-medium">{p.name || p.email}</p>
                          {p.name && <p className="text-xs text-muted-foreground">{p.email}</p>}
                        </TD>
                        <TD>
                          <ul className="flex flex-wrap gap-1.5">
                            {p.roles.map((r) => (
                              <li key={r.id} className="flex items-center gap-1">
                                <Badge tone={r.key === "agency_owner" ? "info" : "neutral"}>{r.name}</Badge>
                                {userId !== ctx.user.id && (r.key !== "agency_owner" || isOwner) && (
                                  <ConfirmAction
                                    action={removeRoleAction}
                                    fields={{ id: r.id }}
                                    title={`Remove ${r.name}?`}
                                    description={`${p.name || p.email} will lose the permissions of this role immediately.`}
                                    confirmLabel="Remove role"
                                    variant="ghost"
                                    size="sm"
                                    destructive
                                  >
                                    <span aria-label={`Remove ${r.name} from ${p.email}`}>×</span>
                                  </ConfirmAction>
                                )}
                              </li>
                            ))}
                          </ul>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {pending.length === 0 ? (
                <EmptyState icon={Mail} title="No pending invitations" className="mx-5 mb-5" />
              ) : (
                <Table>
                  <THead>
                    <tr><TH>Email</TH><TH>Role</TH><TH>Expires</TH><TH className="text-right">Action</TH></tr>
                  </THead>
                  <TBody>
                    {pending.map((i) => (
                      <TR key={i.id}>
                        <TD>{i.email}</TD>
                        <TD>{i.roles?.name}</TD>
                        <TD className="text-muted-foreground">{formatDateTime(i.expires_at)}</TD>
                        <TD className="text-right">
                          <ConfirmAction action={revokeInvitationAction} fields={{ id: i.id }} title="Revoke invitation?" description={`The link sent to ${i.email} will stop working.`} confirmLabel="Revoke" variant="ghost" destructive>
                            Revoke
                          </ConfirmAction>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Invite a team member</CardTitle>
            <CardDescription>The invitation link is valid for 7 days and can be used once.</CardDescription>
          </CardHeader>
          <CardContent>
            <InvitationForm action={inviteStaffAction}>
              <div className="space-y-1.5">
                <label htmlFor="invite-email" className="text-sm font-medium">Email</label>
                <Input id="invite-email" name="email" type="email" autoComplete="off" required />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="invite-role" className="text-sm font-medium">Role</label>
                <NativeSelect id="invite-role" name="role_id" defaultValue="" required>
                  <option value="" disabled>Choose a role…</option>
                  {roleOptions.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </NativeSelect>
              </div>
            </InvitationForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
