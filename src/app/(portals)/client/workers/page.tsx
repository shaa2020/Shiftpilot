import type { Metadata } from "next";
import { Star, Users } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { RatingForm } from "./rating-form";
import { setPreferenceAction } from "./actions";

export const metadata: Metadata = { title: "Workers & feedback" };

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={i <= Math.round(value) ? "size-3.5 fill-amber-400 text-amber-400" : "size-3.5 text-border"} aria-hidden />
      ))}
    </span>
  );
}

export default async function ClientWorkersPage() {
  const ctx = await requireClient();
  const supabase = await createClient();
  const [{ data: recent }, { data: workers }] = await Promise.all([
    supabase.rpc("client_recent_assignments", { p_client_id: ctx.clientId }),
    supabase.rpc("client_worker_overview", { p_client_id: ctx.clientId }),
  ]);
  const toRate = (recent ?? []).filter((r) => r.rating == null);
  const rated = (recent ?? []).filter((r) => r.rating != null).slice(0, 10);
  const canChoose = ctx.capabilities.request;

  return (
    <>
      <PageHeader
        title="Workers & feedback"
        description="Rate the people who worked for you and choose favourites. Preferred workers are offered your shifts first; blocked workers are never scheduled for you."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rate recent shifts</CardTitle>
            <CardDescription>Finished shifts from the last 60 days. Ratings help the agency send the right people.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {toRate.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to rate right now.</p>
            ) : (
              toRate.map((r) => (
                <div key={r.assignment_id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{r.display_name}</p>
                  <p className="mb-2 text-xs text-muted-foreground">{r.shift_title} · {r.location_name} · {formatDate(r.starts_at)}</p>
                  <RatingForm assignmentId={r.assignment_id} />
                </div>
              ))
            )}
            {rated.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Recently rated</p>
                <ul className="space-y-2">
                  {rated.map((r) => (
                    <li key={r.assignment_id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{r.display_name}</span>
                      <Stars value={r.rating ?? 0} />
                      <span className="text-xs text-muted-foreground">{formatDate(r.starts_at)}</span>
                      {r.comment && <span className="w-full truncate text-xs text-muted-foreground">“{r.comment}”</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>People who worked for you</CardTitle>
            <CardDescription>{canChoose ? "Mark favourites or block someone. The agency sees your choice and reason." : "Ask a colleague who can request staff to change preferences."}</CardDescription>
          </CardHeader>
          <CardContent>
            {(workers ?? []).length === 0 ? (
              <EmptyState icon={Users} title="No workers yet" description="Workers appear here after their first shift with you." />
            ) : (
              <ul className="divide-y divide-border">
                {(workers ?? []).map((w) => (
                  <li key={w.worker_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {w.display_name}
                        {w.preference === "preferred" && <Badge tone="success">Preferred</Badge>}
                        {w.preference === "blocked" && <Badge tone="danger">Blocked</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {w.shifts_worked} shift{w.shifts_worked === 1 ? "" : "s"} · last {formatDate(w.last_worked_at)}
                        {w.average_rating != null && <> · <Stars value={Number(w.average_rating)} /> {Number(w.average_rating).toFixed(1)}</>}
                      </p>
                      {w.preference_reason && <p className="text-xs text-muted-foreground">Reason: {w.preference_reason}</p>}
                    </div>
                    {canChoose && (
                      <div className="flex gap-1.5">
                        {w.preference !== "preferred" && (
                          <ConfirmAction action={setPreferenceAction} fields={{ worker_id: w.worker_id, kind: "preferred" }} title={`Prefer ${w.display_name}?`} description="They will be offered your shifts before others." confirmLabel="Prefer">
                            Prefer
                          </ConfirmAction>
                        )}
                        {w.preference !== "blocked" && (
                          <ConfirmAction action={setPreferenceAction} fields={{ worker_id: w.worker_id, kind: "blocked" }} title={`Block ${w.display_name}?`} description="They will not be scheduled for your shifts. Shifts already confirmed are not changed — contact the agency for those." confirmLabel="Block" destructive withReason="Reason (shared with the agency)" reasonOptional variant="ghost">
                            Block
                          </ConfirmAction>
                        )}
                        {w.preference && (
                          <ConfirmAction action={setPreferenceAction} fields={{ worker_id: w.worker_id, kind: "clear" }} title="Remove this preference?" confirmLabel="Remove" variant="ghost">
                            Clear
                          </ConfirmAction>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
