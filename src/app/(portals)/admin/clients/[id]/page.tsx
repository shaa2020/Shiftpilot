import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileSignature, MapPin, UserRound, Users } from "lucide-react";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { SectionTabs } from "@/components/ui/detail";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { Field, CheckboxField } from "@/components/forms/field";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { InvitationForm } from "@/components/forms/invitation-result";
import { revokeInvitationAction } from "../../settings/team/actions";
import { addRateRuleAction, approveRateCardAction, createRateCardAction, removeRateRuleAction } from "../rate-actions";
import { formatMoney } from "@/lib/time";
import { ClientFields } from "../client-fields";
import {
  addContactAction, addContractAction, addLocationAction, deleteContactAction, inviteClientUserAction,
  setClientArchivedAction, setContractStatusAction, setLocationStatusAction, updateClientAction, updateMembershipAction,
} from "../actions";

export const metadata: Metadata = { title: "Client" };

const TABS = ["overview", "locations", "contacts", "users", "contracts", "pricing"] as const;
type Tab = (typeof TABS)[number];

export default async function ClientDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff("clients.read");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "overview";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("*, industries(name)").eq("id", id).maybeSingle();
  if (!client) notFound();
  const canWrite = ctx.can("clients.write");

  const tabs = TABS.filter((t) => t !== "pricing" || ctx.can("rates.read")).map((t) => ({ key: t, label: humanize(t === "users" ? "portal users" : t), href: `/admin/clients/${id}?tab=${t}` }));

  return (
    <>
      <Link href="/admin/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Clients
      </Link>
      <PageHeader
        title={client.name}
        description={[client.industries?.name, client.kvk_number ? `KvK ${client.kvk_number}` : null].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={client.status} />
            {ctx.can("clients.archive") && (
              <ConfirmAction
                action={setClientArchivedAction}
                fields={{ id, archive: String(client.status !== "archived") }}
                title={client.status === "archived" ? "Restore client?" : "Archive client?"}
                description={client.status === "archived" ? "The client becomes active again." : "Archived clients cannot request staff and their users lose portal access. History is kept."}
                confirmLabel={client.status === "archived" ? "Restore" : "Archive"}
                destructive={client.status !== "archived"}
              >
                {client.status === "archived" ? "Restore" : "Archive"}
              </ConfirmAction>
            )}
          </div>
        }
      />
      <SectionTabs tabs={tabs} active={tab} />
      {tab === "overview" && <Overview ctxAgency={ctx.agencyId} client={client} canWrite={canWrite} />}
      {tab === "locations" && <Locations clientId={id} canWrite={canWrite} />}
      {tab === "contacts" && <Contacts clientId={id} canWrite={canWrite} />}
      {tab === "users" && <PortalUsers clientId={id} canWrite={canWrite} />}
      {tab === "contracts" && <Contracts clientId={id} canWrite={canWrite} />}
      {tab === "pricing" && ctx.can("rates.read") && <Pricing clientId={id} agencyId={ctx.agencyId} canWrite={ctx.can("rates.write")} />}
    </>
  );
}

async function Overview({ ctxAgency, client, canWrite }: { ctxAgency: string; client: Parameters<typeof ClientFields>[0]["client"] & { id: string }; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: industries } = await supabase.from("industries").select("id, name").eq("agency_id", ctxAgency).eq("status", "active").order("sort_order");
  return (
    <Card>
      <CardHeader><CardTitle>Client details</CardTitle></CardHeader>
      <CardContent>
        {canWrite ? (
          <ServerForm action={updateClientAction.bind(null, client.id)} submitLabel="Save client">
            <ClientFields client={client} industries={industries ?? []} />
          </ServerForm>
        ) : (
          <fieldset disabled><ClientFields client={client} industries={industries ?? []} /></fieldset>
        )}
      </CardContent>
    </Card>
  );
}

async function Locations({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: locations } = await supabase.from("client_locations").select("*").eq("client_id", clientId).order("name");
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Locations</CardTitle><CardDescription>Workplaces where shifts take place.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">
          {!locations?.length ? (
            <EmptyState icon={MapPin} title="No locations yet" description="Add at least one location before creating shifts." className="mx-5 mb-5" />
          ) : (
            <Table>
              <THead><tr><TH>Location</TH><TH>Site contact</TH><TH>Status</TH>{canWrite && <TH className="text-right">Action</TH>}</tr></THead>
              <TBody>
                {locations.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.address_line1}, {l.postal_code} {l.city}</p>
                    </TD>
                    <TD className="text-muted-foreground">{l.site_contact_name ?? "—"}{l.site_contact_phone ? ` · ${l.site_contact_phone}` : ""}</TD>
                    <TD><StatusBadge status={l.status} /></TD>
                    {canWrite && (
                      <TD className="text-right">
                        <ConfirmAction
                          action={setLocationStatusAction}
                          fields={{ id: l.id, status: l.status === "active" ? "inactive" : "active" }}
                          title={l.status === "active" ? "Deactivate location?" : "Reactivate location?"}
                          description={l.status === "active" ? "No new shifts or requests can be created here. Existing history is kept." : "The location becomes available for shifts again."}
                          variant="ghost"
                        >
                          {l.status === "active" ? "Deactivate" : "Reactivate"}
                        </ConfirmAction>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>Add location</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={addLocationAction.bind(null, clientId)} submitLabel="Add location" resetOnSuccess>
              <Field name="name" label="Name" required><Input name="name" placeholder="Warehouse Amsterdam" /></Field>
              <Field name="address_line1" label="Street and number" required><Input name="address_line1" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field name="postal_code" label="Postal code" required><Input name="postal_code" /></Field>
                <Field name="city" label="City" required><Input name="city" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field name="latitude" label="Latitude"><Input name="latitude" inputMode="decimal" /></Field>
                <Field name="longitude" label="Longitude"><Input name="longitude" inputMode="decimal" /></Field>
              </div>
              <Field name="geofence_radius_m" label="Check-in radius (m)" hint="Used only if location verification is enabled."><Input name="geofence_radius_m" type="number" min={25} max={5000} /></Field>
              <Field name="site_contact_name" label="Site contact"><Input name="site_contact_name" /></Field>
              <Field name="site_contact_phone" label="Site contact phone"><Input name="site_contact_phone" type="tel" /></Field>
              <Field name="arrival_instructions" label="Arrival instructions"><Textarea name="arrival_instructions" rows={3} /></Field>
              <Field name="parking_info" label="Parking"><Input name="parking_info" /></Field>
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Contacts({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: contacts } = await supabase.from("client_contacts").select("*").eq("client_id", clientId).order("is_primary", { ascending: false }).order("full_name");
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Contacts</CardTitle><CardDescription>People at the client. Contacts do not get portal access — invite portal users separately.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">
          {!contacts?.length ? (
            <EmptyState icon={UserRound} title="No contacts yet" className="mx-5 mb-5" />
          ) : (
            <Table>
              <THead><tr><TH>Name</TH><TH>Contact</TH><TH>Role</TH>{canWrite && <TH className="text-right">Action</TH>}</tr></THead>
              <TBody>
                {contacts.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <p className="font-medium">{c.full_name}</p>
                      <p className="text-xs text-muted-foreground">{c.job_title}</p>
                    </TD>
                    <TD className="text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</TD>
                    <TD className="space-x-1">
                      {c.is_primary && <Badge tone="info">Primary</Badge>}
                      {c.is_billing_contact && <Badge>Billing</Badge>}
                    </TD>
                    {canWrite && (
                      <TD className="text-right">
                        <ConfirmAction action={deleteContactAction} fields={{ id: c.id }} title="Remove contact?" variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>Add contact</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={addContactAction.bind(null, clientId)} submitLabel="Add contact" resetOnSuccess>
              <Field name="full_name" label="Full name" required><Input name="full_name" /></Field>
              <Field name="job_title" label="Job title"><Input name="job_title" /></Field>
              <Field name="email" label="Email"><Input name="email" type="email" /></Field>
              <Field name="phone" label="Phone"><Input name="phone" type="tel" /></Field>
              <CheckboxField name="is_primary" label="Primary contact" />
              <CheckboxField name="is_billing_contact" label="Billing contact" />
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const CAPS = [
  ["can_request_staff", "Request staff"],
  ["can_approve_timesheets", "Approve timesheets"],
  ["can_view_finance", "View invoices & pricing"],
  ["can_manage_users", "Manage users"],
] as const;

async function PortalUsers({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("client_memberships").select("*, profiles!client_memberships_user_id_fkey(full_name, email)").eq("client_id", clientId).order("created_at"),
    supabase.from("invitations").select("id, email, client_role, expires_at").eq("client_id", clientId).eq("kind", "client").is("accepted_at", null).is("revoked_at", null),
  ]);
  const pending = (invites ?? []).filter((i) => new Date(i.expires_at) > new Date());
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader><CardTitle>Portal users</CardTitle><CardDescription>Client managers who can sign in to the client portal.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-0">
            {!members?.length ? (
              <EmptyState icon={Users} title="No portal users yet" className="mx-5 mb-5" />
            ) : (
              <Table>
                <THead><tr><TH>User</TH><TH>Capabilities</TH><TH>Status</TH></tr></THead>
                <TBody>
                  {members.map((m) => (
                    <TR key={m.id}>
                      <TD>
                        <p className="font-medium">{m.profiles?.full_name ?? m.profiles?.email}</p>
                        <p className="text-xs text-muted-foreground">{m.profiles?.email} · {humanize(m.role)}</p>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {CAPS.map(([key, label]) => {
                            const on = m[key];
                            return canWrite ? (
                              <ConfirmAction
                                key={key}
                                action={updateMembershipAction}
                                fields={{ id: m.id, field: key, value: String(!on) }}
                                title={`${on ? "Remove" : "Grant"} "${label}"?`}
                                variant={on ? "soft" : "ghost"}
                                size="sm"
                              >
                                {on ? "✓ " : ""}{label}
                              </ConfirmAction>
                            ) : on ? <Badge key={key} tone="info">{label}</Badge> : null;
                          })}
                        </div>
                      </TD>
                      <TD>
                        {canWrite ? (
                          <ConfirmAction
                            action={updateMembershipAction}
                            fields={{ id: m.id, field: "status", value: m.status === "active" ? "inactive" : "active" }}
                            title={m.status === "active" ? "Disable portal access?" : "Re-enable portal access?"}
                            variant="ghost"
                            destructive={m.status === "active"}
                          >
                            <StatusBadge status={m.status} />
                          </ConfirmAction>
                        ) : <StatusBadge status={m.status} />}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {pending.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <THead><tr><TH>Email</TH><TH>Role</TH><TH>Expires</TH><TH className="text-right">Action</TH></tr></THead>
                <TBody>
                  {pending.map((i) => (
                    <TR key={i.id}>
                      <TD>{i.email}</TD>
                      <TD>{humanize(i.client_role ?? "")}</TD>
                      <TD className="text-muted-foreground">{formatDateTime(i.expires_at)}</TD>
                      <TD className="text-right">
                        {canWrite && <ConfirmAction action={revokeInvitationAction} fields={{ id: i.id }} title="Revoke invitation?" variant="ghost" destructive confirmLabel="Revoke">Revoke</ConfirmAction>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>Invite a portal user</CardTitle></CardHeader>
          <CardContent>
            <InvitationForm action={inviteClientUserAction.bind(null, clientId)}>
              <div className="space-y-1.5">
                <label htmlFor="ci-email" className="text-sm font-medium">Email</label>
                <Input id="ci-email" name="email" type="email" required />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ci-role" className="text-sm font-medium">Role</label>
                <NativeSelect id="ci-role" name="client_role" defaultValue="client_manager">
                  <option value="client_admin">Client administrator</option>
                  <option value="client_manager">Manager</option>
                  <option value="client_viewer">Viewer</option>
                </NativeSelect>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Capabilities</legend>
                {CAPS.map(([key, label]) => <CheckboxField key={key} name={key} label={label} defaultChecked={key === "can_request_staff"} />)}
              </fieldset>
            </InvitationForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Contracts({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const { data: contracts } = await supabase.from("client_contracts").select("*").eq("client_id", clientId).order("start_date", { ascending: false });
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Contracts</CardTitle><CardDescription>Framework agreements. Pricing is managed in rate cards.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">
          {!contracts?.length ? (
            <EmptyState icon={FileSignature} title="No contracts yet" className="mx-5 mb-5" />
          ) : (
            <Table>
              <THead><tr><TH>Contract</TH><TH>Period</TH><TH>Status</TH>{canWrite && <TH className="text-right">Action</TH>}</tr></THead>
              <TBody>
                {contracts.map((c) => (
                  <TR key={c.id}>
                    <TD><p className="font-medium">{c.title}</p><p className="text-xs text-muted-foreground">{c.reference}{c.signed_by_name ? ` · signed by ${c.signed_by_name}` : ""}</p></TD>
                    <TD className="text-muted-foreground">{c.start_date} → {c.end_date ?? "open-ended"}</TD>
                    <TD><StatusBadge status={c.status} /></TD>
                    {canWrite && (
                      <TD className="text-right">
                        {c.status === "draft" && (
                          <ConfirmAction action={setContractStatusAction} fields={{ id: c.id, status: "pending_signature" }} title="Send for signature?" description="The contract can no longer be edited once sent." variant="ghost">Send for signature</ConfirmAction>
                        )}
                        {c.status === "pending_signature" && (
                          <ConfirmAction action={setContractStatusAction} fields={{ id: c.id, status: "active" }} title="Record signature" description="Confirm the contract has been signed by both parties." withReason="Signed by (name)" confirmLabel="Mark signed">Mark signed</ConfirmAction>
                        )}
                        {c.status === "active" && (
                          <ConfirmAction action={setContractStatusAction} fields={{ id: c.id, status: "terminated" }} title="Terminate contract?" variant="ghost" destructive confirmLabel="Terminate">Terminate</ConfirmAction>
                        )}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>New contract</CardTitle></CardHeader>
          <CardContent>
            <ServerForm action={addContractAction.bind(null, clientId)} submitLabel="Create draft" resetOnSuccess>
              <Field name="reference" label="Reference" required><Input name="reference" placeholder="RA-2027-001" /></Field>
              <Field name="title" label="Title" required><Input name="title" placeholder="Framework staffing agreement" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field name="start_date" label="Start" required><Input name="start_date" type="date" /></Field>
                <Field name="end_date" label="End"><Input name="end_date" type="date" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field name="payment_term_days" label="Payment term (days)"><Input name="payment_term_days" type="number" min={0} max={180} /></Field>
                <Field name="notice_period_days" label="Notice (days)"><Input name="notice_period_days" type="number" min={0} /></Field>
              </div>
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function Pricing({ clientId, agencyId, canWrite }: { clientId: string; agencyId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const [{ data: cards }, { data: positions }, { data: locations }] = await Promise.all([
    supabase.from("client_rate_cards").select("*, client_rate_rules(*, job_positions(name), client_locations(name))").eq("client_id", clientId).order("effective_from", { ascending: false }),
    supabase.from("job_positions").select("id, name").eq("agency_id", agencyId).eq("status", "active").order("name"),
    supabase.from("client_locations").select("id, name").eq("client_id", clientId).order("name"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {!cards?.length && <EmptyState title="No rate cards yet" description="A client needs an active rate card before assignments can be confirmed." />}
        {(cards ?? []).map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">{c.name} <StatusBadge status={c.status} /></CardTitle>
                <CardDescription>{c.effective_from} → {c.effective_to ?? "open-ended"} · {c.currency}</CardDescription>
              </div>
              {canWrite && c.status === "draft" && (
                <ConfirmAction action={approveRateCardAction} fields={{ id: c.id, client_id: clientId }} title="Approve rate card?" description="The card becomes active from its start date and its rules are locked. The current active card ends the day before." confirmLabel="Approve" variant="default">Approve</ConfirmAction>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!c.client_rate_rules.length ? <p className="text-sm text-muted-foreground">No rules yet.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {c.client_rate_rules.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        <Badge tone={r.rule_kind === "base" ? "info" : "neutral"}>{humanize(r.rule_kind)}</Badge>{" "}
                        <span className="font-medium tabular-nums">{r.hourly_rate != null ? `${formatMoney(Number(r.hourly_rate))}/h` : `× ${r.multiplier}`}</span>
                        <span className="text-muted-foreground"> · {r.job_positions?.name ?? "all positions"} · {r.client_locations?.name ?? "all locations"}
                          {r.days_of_week ? ` · ${r.days_of_week.map((d) => DAY_LABELS[d]).join("/")}` : ""}{r.time_from ? ` · ${r.time_from.slice(0, 5)}–${r.time_to?.slice(0, 5)}` : ""}</span>
                      </span>
                      {canWrite && c.status === "draft" && <ConfirmAction action={removeRateRuleAction} fields={{ id: r.id, client_id: clientId }} title="Remove rule?" variant="ghost" destructive confirmLabel="Remove">Remove</ConfirmAction>}
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && c.status === "draft" && (
                <ServerForm action={addRateRuleAction.bind(null, clientId, c.id)} submitLabel="Add rule" resetOnSuccess className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4" footerClassName="sm:col-span-4">
                  <Field name="rule_kind" label="Rule"><NativeSelect name="rule_kind" defaultValue="base">{["base", "weekend", "night", "public_holiday", "overtime"].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</NativeSelect></Field>
                  <Field name="hourly_rate" label="Hourly rate (€)"><Input name="hourly_rate" type="number" step="0.01" min={0} /></Field>
                  <Field name="multiplier" label="or multiplier"><Input name="multiplier" type="number" step="0.01" min={0} placeholder="1.25" /></Field>
                  <Field name="position_id" label="Position"><NativeSelect name="position_id" defaultValue=""><option value="">All</option>{(positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
                  <Field name="location_id" label="Location"><NativeSelect name="location_id" defaultValue=""><option value="">All</option>{(locations ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
                  <Field name="time_from" label="From (night)"><Input name="time_from" type="time" /></Field>
                  <Field name="time_to" label="To"><Input name="time_to" type="time" /></Field>
                  <fieldset className="flex flex-wrap items-end gap-2 text-xs"><legend className="mb-1 text-sm font-medium">Days</legend>{DAY_LABELS.slice(1).map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="days_of_week" value={i + 1} className="accent-primary" />{d}</label>)}</fieldset>
                </ServerForm>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {canWrite && (
        <Card className="h-fit">
          <CardHeader><CardTitle>New rate card</CardTitle><CardDescription>Client billing rates (excl. VAT). Worker wages and agency margins are never shown to the client.</CardDescription></CardHeader>
          <CardContent>
            <ServerForm action={createRateCardAction.bind(null, clientId)} submitLabel="Create draft" resetOnSuccess>
              <Field name="name" label="Name" required><Input name="name" placeholder="Rates 2027" /></Field>
              <Field name="effective_from" label="Effective from" required><Input name="effective_from" type="date" /></Field>
            </ServerForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
