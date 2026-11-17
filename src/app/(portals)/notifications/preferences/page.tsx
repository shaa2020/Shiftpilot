import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { vapidPublicKey, serverEnv } from "@/lib/env";
import { formatDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { ServerForm } from "@/components/forms/server-form";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { PushToggle } from "@/components/notifications/push-toggle";
import { disablePushAction, registerPushAction, savePreferencesAction } from "../actions";

export const metadata: Metadata = { title: "Notification preferences" };

const EVENTS: [string, string, boolean][] = [
  ["*", "All other notifications", false],
  ["shift.invited", "Shift offers", true],
  ["shift.reminder", "Shift reminders", true],
  ["shift.cancelled", "Shift cancellations", true],
  ["attendance.missing_check_in", "Missing check-ins", true],
  ["timesheet.submitted", "Timesheets to review", true],
  ["timesheet.disputed", "Timesheet disputes", true],
  ["invoice.issued", "New invoices", true],
  ["invoice.overdue", "Overdue invoices", true],
  ["document.rejected", "Rejected documents", true],
  ["document.expiring", "Expiring documents", true],
];

export default async function PreferencesPage({ searchParams }: { searchParams: Promise<{ agency?: string }> }) {
  const user = await requireUser("/notifications/preferences");
  const supabase = await createClient();
  const [{ data: agencies }, { data: prefs }, { data: subs }] = await Promise.all([
    supabase.rpc("my_agencies"),
    supabase.from("notification_preferences").select("agency_id, event_type, channel, enabled").eq("user_id", user.id),
    supabase.from("push_subscriptions").select("id, user_agent, created_at").is("disabled_at", null).order("created_at", { ascending: false }),
  ]);
  const { agency } = await searchParams;
  const agencyId = agencies?.find((a) => a.agency_id === agency)?.agency_id ?? agencies?.[0]?.agency_id;
  const pref = (event: string, channel: string, def: boolean) => prefs?.find((p) => p.agency_id === agencyId && p.event_type === event && p.channel === channel)?.enabled ?? def;
  const vapid = vapidPublicKey();
  const whatsapp = Boolean(serverEnv.whatsappToken() && serverEnv.whatsappPhoneNumberId());
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/notifications" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Notifications</Link>
      <PageHeader title="Notification preferences" description="In-app notifications are always kept. Choose which ones also reach you by email, push or WhatsApp." />
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Push on this device</CardTitle><CardDescription>Receive alerts even when ShiftPilot is closed.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {vapid ? <PushToggle vapidKey={vapid} register={registerPushAction} /> : <p className="text-sm text-muted-foreground">Push notifications are awaiting configuration by the platform administrator (VAPID keys).</p>}
            {!!subs?.length && (
              <ul className="divide-y divide-border text-sm">
                {subs.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="truncate text-muted-foreground">{s.user_agent?.slice(0, 80) ?? "Device"} · since {formatDate(s.created_at)}</span>
                    <ConfirmAction action={disablePushAction} fields={{ id: s.id }} title="Stop push on this device?" variant="ghost" confirmLabel="Remove">Remove</ConfirmAction>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {agencyId && (
          <Card>
            <CardHeader>
              <CardTitle>Channels</CardTitle>
              <CardDescription>{whatsapp ? "WhatsApp messages are opt-in and sent to the phone number in your profile." : "WhatsApp is awaiting configuration; your choice is saved for when it is enabled."}</CardDescription>
            </CardHeader>
            <CardContent>
              {agencies && agencies.length > 1 && (
                <form className="mb-4 flex items-center gap-2 text-sm">
                  <label htmlFor="agency">Organisation</label>
                  <NativeSelect id="agency" name="agency" defaultValue={agencyId}>{agencies.map((a) => <option key={a.agency_id} value={a.agency_id}>{a.name}</option>)}</NativeSelect>
                  <button className="text-primary hover:underline">Switch</button>
                </form>
              )}
              <ServerForm action={savePreferencesAction} submitLabel="Save preferences">
                <input type="hidden" name="agency_id" value={agencyId} />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-2 font-medium">Notification</th><th className="w-20 text-center font-medium">Email</th><th className="w-20 text-center font-medium">Push</th><th className="w-24 text-center font-medium">WhatsApp</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {EVENTS.map(([event, label, emailDefault]) => (
                        <tr key={event}>
                          <td className="py-2"><input type="hidden" name="event" value={event} />{label}</td>
                          {(["email", "push", "whatsapp"] as const).map((ch) => (
                            <td key={ch} className="text-center">
                              <input type="checkbox" aria-label={`${label} by ${ch}`} name={`${event}:${ch}`} defaultChecked={pref(event, ch, ch === "email" ? emailDefault : ch === "push")} className="size-4 accent-primary" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ServerForm>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
