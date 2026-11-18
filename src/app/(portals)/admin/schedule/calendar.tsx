"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar, { type CalendarRef, type EventDropInfo, type EventInput, type EventResizeDoneInfo, type EventSourceFuncInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/input";
import { getScheduleEvents } from "./actions";
import { moveShiftAction } from "../shifts/actions";

type Opt = { id: string; name: string };

export function ScheduleCalendar({ clients, locations, positions, workers, canEdit }: { clients: Opt[]; locations: (Opt & { client_id: string })[]; positions: Opt[]; workers: Opt[]; canEdit: boolean }) {
  const router = useRouter();
  const ref = useRef<CalendarRef>(null);
  const [filters, setFilters] = useState({ client: "", location: "", position: "", worker: "", unfilled: false });

  const source = useCallback(
    // Events load in the browser only (never during server rendering).
    async (info: EventSourceFuncInfo) =>
      typeof window === "undefined" ? [] : ((await getScheduleEvents({ start: info.startStr, end: info.endStr, ...filters })) as EventInput[]),
    [filters],
  );
  const eventSources = useMemo(() => [source], [source]);

  const onMove = async (arg: EventDropInfo | EventResizeDoneInfo) => {
    const { event } = arg;
    if (!event.start || !event.end) return arg.revert();
    const res = await moveShiftAction(event.id, event.start.toISOString(), event.end.toISOString());
    if (res.ok) toast.success(res.message);
    else {
      toast.error(res.message ?? "The shift could not be moved");
      arg.revert();
    }
  };

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        <NativeSelect value={filters.client} onChange={set("client")} aria-label="Client"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <NativeSelect value={filters.location} onChange={set("location")} aria-label="Location"><option value="">All locations</option>{locations.filter((l) => !filters.client || l.client_id === filters.client).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect>
        <NativeSelect value={filters.position} onChange={set("position")} aria-label="Position"><option value="">All positions</option>{positions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <NativeSelect value={filters.worker} onChange={set("worker")} aria-label="Worker"><option value="">All workers</option>{workers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.unfilled} onChange={set("unfilled")} className="size-4 accent-primary" />Unfilled only</label>
      </div>
      {filters.worker && <p className="text-xs text-muted-foreground">Green background: declared availability. Red: unavailable.</p>}
      <div className="rounded-lg border border-border bg-surface p-2 text-sm [&_.fc-toolbar-title]:text-base [&_.fc-button]:!text-xs">
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, classicThemePlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth" }}
          firstDay={1}
          locale="en-GB"
          timeZone="Europe/Amsterdam"
          height="auto"
          slotMinTime="00:00:00"
          scrollTime="06:00:00"
          nowIndicator
          eventSources={eventSources}
          editable={canEdit}
          eventStartEditable={canEdit}
          eventDurationEditable={canEdit}
          eventDrop={onMove}
          eventResize={onMove}
          eventClick={(info) => {
            if (info.event.extendedProps.kind === "shift") router.push(`/admin/shifts/${info.event.id}`);
          }}
        />
      </div>
    </div>
  );
}
