import type { Metadata } from "next";
import { Coffee, Inbox, MapPin, Shirt, Sparkles } from "lucide-react";
import { requireWorker } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, nowMs } from "@/lib/time";
import { durationLabel, expiresIn, shiftLength } from "@/lib/shift-format";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Alert } from "@/components/ui/alert";
import { SectionTabs } from "@/components/ui/detail";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ShiftCard } from "@/components/worker/shift-ui";
import { clarifyInvitationAction, expressInterestAction, respondAssignmentAction, respondInvitationAction } from "../actions";

export const metadata: Metadata = { title: "Offers" };

type Loc = { name: string; address_line1: string | null; postal_code: string | null; city: string | null; arrival_instructions: string | null } | null;
type Offer = {
  kind: "invitation" | "assignment"; id: string; title: string; starts_at: string; ends_at: string; break_minutes: number; dress_code: string | null;
  loc: Loc; position: string; client: string; instructions: string | null; expires_at?: string | null; clarification?: string | null;
};
const SHIFT = "title, starts_at, ends_at, break_minutes, dress_code, instructions, clients(name), client_locations(name, address_line1, postal_code, city, arrival_instructions)";

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireWorker();
  const { tab: rawTab } = await searchParams;
  const supabase = await createClient();
  const now = nowMs();
  const [inv, asg, available] = await Promise.all([
    supabase.from("shift_invitations").select(`id, expires_at, clarification_request, shifts(${SHIFT}), shift_positions(job_positions(name))`).eq("worker_id", ctx.workerId).eq("status", "pending"),
    supabase.from("shift_assignments").select(`id, shifts(${SHIFT}), shift_positions(job_positions(name))`).eq("worker_id", ctx.workerId).eq("status", "invited"),
    ctx.status === "active" ? supabase.rpc("worker_available_shifts", { p_worker_id: ctx.workerId }) : Promise.resolve({ data: [] }),
  ]);
  const toOffer = (kind: Offer["kind"], id: string, sh: NonNullable<NonNullable<typeof asg.data>[number]["shifts"]>, position: string | undefined, extra: Partial<Offer> = {}): Offer => ({
    kind, id, title: sh.title, starts_at: sh.starts_at, ends_at: sh.ends_at, break_minutes: sh.break_minutes, dress_code: sh.dress_code,
    loc: sh.client_locations as Loc, position: position ?? "", client: sh.clients?.name ?? "", instructions: sh.instructions, ...extra,
  });
  const offers: Offer[] = [
    ...(inv.data ?? []).filter((i) => i.shifts).map((i) => toOffer("invitation", i.id, i.shifts!, i.shift_positions?.job_positions?.name, { expires_at: i.expires_at, clarification: i.clarification_request })),
    ...(asg.data ?? []).filter((a) => a.shifts).map((a) => toOffer("assignment", a.id, a.shifts!, a.shift_positions?.job_positions?.name)),
  ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const open = available.data ?? [];
  const tab = rawTab === "open" ? "open" : "offers";

  return (
    <>
      <PageHeader title="Offers" description="Shifts offered to you, and open shifts you can ask for." />
      <SectionTabs
        tabs={[
          { key: "offers", label: `For you${offers.length ? ` (${offers.length})` : ""}`, href: "?tab=offers" },
          { key: "open", label: `Open shifts${open.length ? ` (${open.length})` : ""}`, href: "?tab=open" },
        ]}
        active={tab}
      />

      {tab === "offers" && (
        <section className="space-y-3">
          {offers.length === 0 && (
            <EmptyState icon={Inbox} title="No offers right now" description="When the agency offers you a shift it appears here and you get a notification." />
          )}
          {offers.map((o) => {
            const respond = o.kind === "invitation" ? respondInvitationAction : respondAssignmentAction;
            const len = shiftLength(o.starts_at, o.ends_at, o.break_minutes);
            const expiry = expiresIn(o.expires_at, now);
            const address = [o.loc?.address_line1, [o.loc?.postal_code, o.loc?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
            return (
              <ShiftCard
                key={`${o.kind}-${o.id}`}
                s={{ title: o.title, starts_at: o.starts_at, ends_at: o.ends_at, break_minutes: o.break_minutes, position: o.position, client: o.client, location: o.loc?.name, city: o.loc?.city, chip: expiry ? { label: expiry, tone: "warning" } : null }}
              >
                <div className="space-y-3 pt-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Coffee className="size-3.5" aria-hidden />{o.break_minutes ? `${o.break_minutes} min break` : "No break"} · {durationLabel(len.paid)} paid</span>
                    {o.dress_code && <span className="inline-flex items-center gap-1"><Shirt className="size-3.5" aria-hidden />{o.dress_code}</span>}
                  </div>
                  {(address || o.instructions || o.loc?.arrival_instructions) && (
                    <details className="rounded-lg bg-surface-muted p-2.5 text-sm">
                      <summary className="cursor-pointer font-medium text-primary">More details</summary>
                      <div className="mt-2 space-y-2">
                        {address && <p className="flex gap-1.5"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />{address}</p>}
                        {o.loc?.arrival_instructions && <p><span className="font-medium">On arrival: </span>{o.loc.arrival_instructions}</p>}
                        {o.instructions && <p className="whitespace-pre-line"><span className="font-medium">Instructions: </span>{o.instructions}</p>}
                        {o.expires_at && <p className="text-xs text-muted-foreground">Offer open until {formatDateTime(o.expires_at)}</p>}
                      </div>
                    </details>
                  )}
                  {o.clarification && <Alert tone="info">You asked: {o.clarification}</Alert>}
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    <ConfirmAction action={respond} fields={{ id: o.id, accept: "true" }} title="Accept this shift?" description="You commit to working this shift once the agency confirms it." variant="default" size="default" confirmLabel="Accept">Accept</ConfirmAction>
                    <ConfirmAction action={respond} fields={{ id: o.id, accept: "false" }} title="Decline this shift?" withReason="Reason (optional)" reasonOptional variant="secondary" size="default" confirmLabel="Decline">Decline</ConfirmAction>
                    {o.kind === "invitation" && (
                      <span className="col-span-2"><ConfirmAction action={clarifyInvitationAction} fields={{ id: o.id }} title="Ask the agency a question" withReason="Your question" variant="ghost" size="default" confirmLabel="Send">Ask a question</ConfirmAction></span>
                    )}
                  </div>
                </div>
              </ShiftCard>
            );
          })}
        </section>
      )}

      {tab === "open" && (
        <section>
          <p className="mb-3 text-sm text-muted-foreground">Open shifts you are eligible for. Tell the agency you are interested — they confirm who gets it.</p>
          {ctx.status !== "active" ? <Alert tone="info">Available once your onboarding is complete.</Alert>
            : open.length === 0 ? <EmptyState icon={Sparkles} title="No open shifts that match your profile right now" description="Keep your availability and skills up to date to see more." />
            : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {open.map((s) => (
                  <li key={s.shift_position_id}>
                    <ShiftCard s={{ title: s.title, starts_at: s.starts_at, ends_at: s.ends_at, break_minutes: s.break_minutes, position: s.position_name, client: s.client_name, location: s.location_name, city: s.city, chip: { label: `${s.open_slots} place${s.open_slots === 1 ? "" : "s"} left`, tone: "info" } }}>
                      <div className="pt-2">
                        <ConfirmAction action={expressInterestAction} fields={{ id: s.shift_position_id }} title="Tell the agency you are interested?" variant="soft">I&apos;m interested</ConfirmAction>
                      </div>
                    </ShiftCard>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </>
  );
}
