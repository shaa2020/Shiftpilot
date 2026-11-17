import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Input, NativeSelect } from "@/components/ui/input";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { CheckboxField } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { InvitationForm } from "@/components/forms/invitation-result";
import { inviteTeamMemberAction, updateTeamMemberAction } from "../actions";

export const metadata: Metadata = { title: "Team" };
const CAPS = [["can_request_staff", "Request staff"], ["can_approve_timesheets", "Approve timesheets"], ["can_view_finance", "Invoices & pricing"], ["can_manage_users", "Manage users"]] as const;

export default async function ClientTeamPage() {
  const ctx = await requireClient();
  if (!ctx.capabilities.manageUsers) return <Alert tone="warning">Only users who may manage the team can open this page.</Alert>;
  const supabase = await createClient();
  const { data: team } = await supabase.rpc("client_team", { p_client_id: ctx.clientId });
  return (
    <>
      <PageHeader title="Team" description={`People at ${ctx.clientName} with access to this portal.`} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            {!team?.length ? <EmptyState icon={Users} title="No members" /> : (
              <ul className="divide-y divide-border text-sm">
                {team.map((m) => (
                  <li key={m.membership_id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><span className="font-medium">{m.full_name ?? m.email}</span> <span className="text-muted-foreground">· {m.email} · {humanize(m.role)}</span></span>
                      {m.is_self ? <StatusBadge status={m.status} /> : (
                        <ConfirmAction action={updateTeamMemberAction} fields={{ id: m.membership_id, field: "status", value: m.status === "active" ? "inactive" : "active" }} title={m.status === "active" ? "Disable access?" : "Enable access?"} variant="ghost" destructive={m.status === "active"}><StatusBadge status={m.status} /></ConfirmAction>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {CAPS.map(([k, label]) => {
                        const on = m[k];
                        return m.is_self ? <span key={k} className="text-xs text-muted-foreground">{on ? `✓ ${label}` : ""}</span> : (
                          <ConfirmAction key={k} action={updateTeamMemberAction} fields={{ id: m.membership_id, field: k, value: String(!on) }} title={`${on ? "Remove" : "Grant"} "${label}"?`} variant={on ? "soft" : "ghost"}>{on ? "✓ " : ""}{label}</ConfirmAction>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader><CardTitle>Invite a colleague</CardTitle></CardHeader>
          <CardContent>
            <InvitationForm action={inviteTeamMemberAction}>
              <div className="space-y-1.5"><label htmlFor="ti-email" className="text-sm font-medium">Email</label><Input id="ti-email" name="email" type="email" required /></div>
              <div className="space-y-1.5"><label htmlFor="ti-role" className="text-sm font-medium">Role</label>
                <NativeSelect id="ti-role" name="client_role" defaultValue="client_manager"><option value="client_admin">Administrator</option><option value="client_manager">Manager</option><option value="client_viewer">Viewer</option></NativeSelect></div>
              <fieldset className="space-y-2"><legend className="text-sm font-medium">Capabilities</legend>{CAPS.map(([k, l]) => <CheckboxField key={k} name={k} label={l} defaultChecked={k === "can_request_staff"} />)}</fieldset>
            </InvitationForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
