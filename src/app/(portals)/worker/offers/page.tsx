import type { Metadata } from "next";
import { Inbox, Sparkles } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, formatDateTime } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { clarifyInvitationAction, expressInterestAction, respondAssignmentAction, respondInvitationAction } from "../actions";

export const metadata: Metadata = { title: "Offers" };

type Offer = { kind: "invitation" | "assignment"; id: string; title: string; starts_at: string; ends_at: string; location: string; city: string; position: string; client: string; instructions: string | null; expires_at?: string | null; clarification?: string | null };

export default async function OffersPage() {
  const ctx = await requireWorker();
  const supabase = await createClient();
  const [inv, asg, available] = await Promise.all([
    supabase.from("shift_invitations").select("id, expires_at, clarification_request, shifts(title, starts_at, ends_at, instructions, clients(name), client_locations(name, city)), shift_positions(job_positions(name))").eq("worker_id", ctx.workerId).eq("status", "pending"),
    supabase.from("shift_assignments").select("id, shifts(title, starts_at, ends_at, instructions, clients(name), client_locations(name, city)), shift_positions(job_positions(name))").eq("worker_id", ctx.workerId).eq("status", "invited"),
    ctx.status === "active" ? supabase.rpc("worker_available_shifts", { p_worker_id: ctx.workerId }) : Promise.resolve({ data: [] }),
  ]);
  const offers: Offer[] = [
    ...(inv.data ?? []).filter((i) => i.shifts).map((i) => ({ kind: "invitation" as const, id: i.id, title: i.shifts!.title, starts_at: i.shifts!.starts_at, ends_at: i.shifts!.ends_at, location: i.shifts!.client_locations?.name ?? "", city: i.shifts!.client_locations?.city ?? "", position: i.shift_positions?.job_positions?.name ?? "", client: i.shifts!.clients?.name ?? "", instructions: i.shifts!.instructions, expires_at: i.expires_at, clarification: i.clarification_request })),
    ...(asg.data ?? []).filter((a) => a.shifts).map((a) => ({ kind: "assignment" as const, id: a.id, title: a.shifts!.title, starts_at: a.shifts!.starts_at, ends_at: a.shifts!.ends_at, location: a.shifts!.client_locations?.name ?? "", city: a.shifts!.client_locations?.city ?? "", position: a.shift_positions?.job_positions?.name ?? "", client: a.shifts!.clients?.name ?? "", instructions: a.shifts!.instructions })),
  ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <>
      <PageHeader title="Offers" description="Shifts offered to you. Accepting is binding once the agency confirms." />
      <section className="space-y-3">
        {offers.length === 0 && <EmptyState icon={Inbox} title="No open offers" />}
        {offers.map((o) => {
          const respond = o.kind === "invitation" ? respondInvitationAction : respondAssignmentAction;
          return (
            <Card key={`${o.kind}-${o.id}`}>
              <CardHeader>
                <CardTitle>{o.title}</CardTitle>
                <CardDescription>{o.position} · {o.client}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{formatDate(o.starts_at)} · {formatTime(o.starts_at)}–{formatTime(o.ends_at)}<br /><span className="text-muted-foreground">{o.location}, {o.city}</span></p>
                {o.instructions && <p className="whitespace-pre-wrap text-muted-foreground">{o.instructions}</p>}
                {o.expires_at && <p className="text-xs text-warning">Respond before {formatDateTime(o.expires_at)}</p>}
                {o.clarification && <Alert tone="info">Your question: {o.clarification}</Alert>}
                <div className="flex flex-wrap gap-2">
                  <ConfirmAction action={respond} fields={{ id: o.id, accept: "true" }} title="Accept this shift?" description="You commit to working this shift once the agency confirms it." variant="default" size="default" confirmLabel="Accept">Accept</ConfirmAction>
                  <ConfirmAction action={respond} fields={{ id: o.id, accept: "false" }} title="Decline this shift?" withReason="Reason (optional)" reasonOptional variant="secondary" size="default" confirmLabel="Decline">Decline</ConfirmAction>
                  {o.kind === "invitation" && <ConfirmAction action={clarifyInvitationAction} fields={{ id: o.id }} title="Ask the agency a question" withReason="Your question" variant="ghost" size="default" confirmLabel="Send">Ask a question</ConfirmAction>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Available shifts</h2>
        <p className="mb-3 text-sm text-muted-foreground">Open shifts you are eligible for. Let the agency know you are interested.</p>
        {ctx.status !== "active" ? <Alert tone="info">Available once your onboarding is complete.</Alert>
          : !available.data?.length ? <EmptyState icon={Sparkles} title="No open shifts that match your profile right now" />
          : (
            <ul className="grid gap-3 md:grid-cols-2">
              {available.data.map((s) => (
                <li key={s.shift_position_id}>
                  <Card>
                    <CardContent className="space-y-2 pt-5 text-sm">
                      <p className="font-medium">{s.title} <span className="text-muted-foreground">· {s.position_name}</span></p>
                      <p>{formatDate(s.starts_at)} · {formatTime(s.starts_at)}–{formatTime(s.ends_at)}</p>
                      <p className="text-muted-foreground">{s.client_name} · {s.location_name}, {s.city} · {s.open_slots} place(s)</p>
                      <ConfirmAction action={expressInterestAction} fields={{ id: s.shift_position_id }} title="Tell the agency you are interested?" variant="soft">I&apos;m interested</ConfirmAction>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
      </section>
    </>
  );
}
