import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, Clock, Coffee, Languages, LogIn, LogOut, MapPin, MessageSquare, Shirt, Star, Users } from "lucide-react";
import { requireClient } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, nowMs } from "@/lib/time";
import { durationLabel, minutesBetween, startsIn } from "@/lib/shift-format";
import { EmptyState } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { DateTile, DetailRow } from "@/components/worker/shift-ui";
import { Avatar, FillBar } from "@/components/client/fill";
import { clientReplacementAction } from "../../actions";

export const metadata: Metadata = { title: "Shift" };

export default async function ClientShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClient();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const now = nowMs();
  const { data: s } = await supabase
    .from("shifts")
    .select("*, client_locations(name, address_line1, postal_code, city), shift_positions(headcount, filled_count, job_positions(name))")
    .eq("id", id).eq("client_id", ctx.clientId).maybeSingle();
  if (!s) notFound();
  const { data: staff } = await supabase.rpc("client_shift_staff", { p_shift_id: id });
  const total = s.shift_positions.reduce((n, p) => n + p.headcount, 0);
  const filled = s.shift_positions.reduce((n, p) => n + p.filled_count, 0);
  const when = startsIn(s.starts_at, s.ends_at, now);
  const finished = new Date(s.ends_at).getTime() < now;
  const loc = s.client_locations;
  const subject = encodeURIComponent(`${s.title} · ${formatDate(s.starts_at)}`);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/client/shifts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Shifts</Link>
      <Card className="mb-5 overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40" aria-hidden />
        <CardContent className="space-y-4 pt-5">
          <div className="flex gap-4">
            <DateTile iso={s.starts_at} className="w-16" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={s.status} />
                {s.status !== "cancelled" && !finished && <Badge tone={when.tone}>{when.label}</Badge>}
              </div>
              <h1 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{s.title}</h1>
              <p className="text-sm text-muted-foreground">{formatDate(s.starts_at)} · <span className="tabular-nums">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</span></p>
            </div>
          </div>
          {s.status !== "cancelled" && <FillBar filled={filled} total={total} />}
          <div className="flex flex-wrap gap-2">
            {s.shift_positions.map((p, i) => <Badge key={i} tone={p.filled_count >= p.headcount ? "success" : "warning"}>{p.job_positions?.name}: {p.filled_count}/{p.headcount}</Badge>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm"><Link href={`/client/messages?subject=${subject}`}><MessageSquare aria-hidden /> Message the agency</Link></Button>
            {finished && <Button asChild variant="secondary" size="sm"><Link href="/client/workers"><Star aria-hidden /> Rate the workers</Link></Button>}
          </div>
        </CardContent>
      </Card>
      {s.status === "cancelled" && <Alert tone="danger" title="Cancelled" className="mb-5">{s.cancellation_reason}</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4" aria-hidden /> Workers ({staff?.length ?? 0})</CardTitle></CardHeader>
          <CardContent>
            {!staff?.length ? <EmptyState icon={Users} title="No workers confirmed yet" description="You are notified as soon as workers are confirmed." /> : (
              <ul className="space-y-3">
                {staff.map((w) => (
                  <li key={w.assignment_id} className="rounded-xl border border-border p-3.5">
                    <div className="flex items-start gap-3">
                      <Avatar name={w.worker_display_name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{w.worker_display_name}</p>
                          <StatusBadge status={w.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">{w.position_name}</p>
                      </div>
                    </div>
                    {w.professional_summary && <p className="mt-2 text-sm text-foreground/80">{w.professional_summary}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {w.certificates.map((c) => <Badge key={c}><Award className="size-3" aria-hidden />{c}</Badge>)}
                      {w.languages.length > 0 && <Badge><Languages className="size-3" aria-hidden />{w.languages.join(", ")}</Badge>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
                      {w.checked_in_at ? <Badge tone="success"><LogIn className="size-3" aria-hidden /> In {formatTime(w.checked_in_at)}</Badge> : <span className="text-muted-foreground">Not checked in</span>}
                      {w.checked_out_at && <Badge><LogOut className="size-3" aria-hidden /> Out {formatTime(w.checked_out_at)}</Badge>}
                      {ctx.capabilities.request && w.status === "confirmed" && !finished && (
                        <span className="ml-auto"><ConfirmAction action={clientReplacementAction} fields={{ id: w.assignment_id }} title="Request a replacement or report absence?" description="The agency will arrange another worker and keep you informed." withReason="Reason" variant="ghost">Request replacement</ConfirmAction></span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:self-start">
          <CardHeader><CardTitle>Shift details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <DetailRow icon={Clock} label="Time"><p className="tabular-nums">{formatTime(s.starts_at)}–{formatTime(s.ends_at)}</p><p className="text-muted-foreground">{durationLabel(minutesBetween(s.starts_at, s.ends_at))} incl. break</p></DetailRow>
            <DetailRow icon={Coffee} label="Break">{s.break_minutes ? `${s.break_minutes} minutes` : "No break"}</DetailRow>
            <DetailRow icon={MapPin} label="Location"><p className="font-medium">{loc?.name}</p><p className="text-muted-foreground">{[loc?.address_line1, [loc?.postal_code, loc?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p></DetailRow>
            {s.dress_code && <DetailRow icon={Shirt} label="Dress code">{s.dress_code}</DetailRow>}
            {s.instructions && <div className="rounded-xl bg-surface-muted p-3 text-sm"><p className="font-medium">Instructions for workers</p><p className="mt-1 whitespace-pre-line text-muted-foreground">{s.instructions}</p></div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
