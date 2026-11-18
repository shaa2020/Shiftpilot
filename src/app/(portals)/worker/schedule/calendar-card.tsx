"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarPlus, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createCalendarFeedAction, deleteCalendarFeedAction } from "./calendar-actions";

/** Subscribe-to-calendar card. The secret link is shown once, right after it is created. */
export function CalendarCard({ active, lastUsed }: { active: boolean; lastUsed: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = () =>
    start(async () => {
      const r = await createCalendarFeedAction();
      if (r.ok && r.data?.url) { setUrl(r.data.url); toast.success("Calendar link ready"); } else toast.error(r.message ?? "Could not create the link");
    });
  const remove = () =>
    start(async () => {
      const r = await deleteCalendarFeedAction();
      if (r.ok) { setUrl(null); toast.success(r.message ?? "Turned off"); } else toast.error(r.message ?? "Could not turn it off");
    });
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarPlus className="size-4" aria-hidden /> Add shifts to your calendar</CardTitle>
        <CardDescription>
          Subscribe in Google Calendar, Apple Calendar or Outlook. New and changed shifts appear automatically (calendar apps refresh every few hours).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {url ? (
          <div className="space-y-2">
            <p className="font-medium">Your private link — keep it to yourself:</p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-muted px-2 py-1.5 text-xs" data-testid="calendar-url">{url}</code>
              <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Copied"))}>
                <Copy aria-hidden /> Copy
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm"><a href={url.replace(/^https?:/, "webcal:")}>Open in calendar app</a></Button>
              <Button asChild size="sm" variant="secondary"><a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, "webcal:"))}`} target="_blank" rel="noopener noreferrer">Add to Google Calendar</a></Button>
            </div>
          </div>
        ) : active ? (
          <p className="text-muted-foreground">
            Your calendar link is active{lastUsed ? ` (last synced ${new Date(lastUsed).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })})` : ""}. Lost it? Create a new link — the old one stops working.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={active || url ? "secondary" : "default"} onClick={create} disabled={pending}>
            {active || url ? "Create a new link" : "Create calendar link"}
          </Button>
          {(active || url) && (
            <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={pending}>Turn off</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
