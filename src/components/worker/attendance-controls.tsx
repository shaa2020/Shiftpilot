"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Coffee, LogIn, LogOut, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { recordAttendanceAction } from "@/app/(portals)/worker/actions";

type EventType = "check_in" | "check_out" | "break_start" | "break_end";
interface Queued { assignmentId: string; type: EventType; key: string; deviceTime: string }
const QUEUE_KEY = "sp-attendance-queue";

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Queued[];
  } catch {
    return [];
  }
}
function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable */
  }
}

function getPosition(): Promise<GeolocationPosition | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }));
}

/**
 * Check-in/out and break buttons. Online events are timestamped by the server.
 * When offline, events are queued on the device with the device time and
 * synchronised later — they are flagged as offline and never presented as
 * real-time verified attendance. Location is requested only when the agency
 * enabled verification, and only at the moment of the event.
 */
export function AttendanceControls({ assignmentId, status, breakOpen, locationEnabled, privacyNotice }: {
  assignmentId: string; status: string; breakOpen: boolean; locationEnabled: boolean; privacyNotice?: string | null;
}) {
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState(0);

  const sync = useCallback(async () => {
    const q = readQueue();
    if (!q.length || !navigator.onLine) return;
    const remaining: Queued[] = [];
    for (const item of q) {
      try {
        const res = await recordAttendanceAction({ ...item, offline: true, latitude: null, longitude: null, accuracy: null });
        if (res.ok) toast.success(res.message);
        else toast.error(`Offline event could not be synchronised: ${res.message}`);
      } catch {
        remaining.push(item);
      }
    }
    writeQueue(remaining);
    setQueued(remaining.filter((r) => r.assignmentId === assignmentId).length);
  }, [assignmentId]);

  useEffect(() => {
    const count = readQueue().filter((r) => r.assignmentId === assignmentId).length;
    const t = setTimeout(() => {
      setQueued(count);
      void sync();
    }, 0);
    window.addEventListener("online", sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", sync);
    };
  }, [assignmentId, sync]);

  const act = (type: EventType) =>
    start(async () => {
      const key = crypto.randomUUID();
      const deviceTime = new Date().toISOString();
      const enqueue = () => {
        writeQueue([...readQueue(), { assignmentId, type, key, deviceTime }]);
        setQueued((n) => n + 1);
        toast.warning("You are offline. Saved on this device and will be sent when you are back online — not yet confirmed.");
      };
      if (!navigator.onLine) return enqueue();
      const pos = locationEnabled && (type === "check_in" || type === "check_out") ? await getPosition() : null;
      try {
        const res = await recordAttendanceAction({
          assignmentId, type, key, deviceTime, offline: false,
          latitude: pos?.coords.latitude ?? null, longitude: pos?.coords.longitude ?? null, accuracy: pos?.coords.accuracy ?? null,
        });
        if (res.ok) toast.success(res.message);
        else toast.error(res.message ?? "Could not record attendance");
      } catch {
        enqueue();
      }
    });

  return (
    <div className="space-y-3">
      {queued > 0 && (
        <Alert tone="warning" title="Waiting to synchronise">
          <span className="inline-flex items-center gap-1"><WifiOff className="size-4" aria-hidden /> {queued} event(s) saved offline. They will be sent automatically and marked as offline.</span>
        </Alert>
      )}
      {locationEnabled && (status === "confirmed" || status === "checked_in") && (
        <p className="text-xs text-muted-foreground">{privacyNotice ?? "Your location is recorded only when you check in or out."}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {status === "confirmed" && <Button size="lg" className="col-span-2" disabled={pending} onClick={() => act("check_in")}><LogIn /> Check in</Button>}
        {status === "checked_in" && !breakOpen && <Button size="lg" variant="secondary" disabled={pending} onClick={() => act("break_start")}><Coffee /> Start break</Button>}
        {status === "checked_in" && breakOpen && <Button size="lg" variant="secondary" disabled={pending} onClick={() => act("break_end")}><Coffee /> End break</Button>}
        {status === "checked_in" && <Button size="lg" variant="destructive" disabled={pending} onClick={() => act("check_out")}><LogOut /> Check out</Button>}
      </div>
    </div>
  );
}
