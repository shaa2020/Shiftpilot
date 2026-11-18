"use client";
import { useActionState, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/actions/state";

export interface RequestFormProps {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  types: { id: string; name: string }[];
  /** Fixed worker (worker profile); otherwise a searchable multi-select. */
  workerId?: string;
  workers?: { id: string; name: string; number: string }[];
  minDate: string;
}

/** Request a document from one worker, several workers, or everyone missing a required type. */
export function RequestDocumentForm({ action, types, workerId, workers = [], minDate }: RequestFormProps) {
  const [typeId, setTypeId] = useState("");
  const [target, setTarget] = useState<"selected" | "missing_required">("selected");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (p: ActionState, fd: FormData) => {
    const r = await action(p, fd);
    if (r.ok && r.message) toast.success(r.message);
    if (r.ok) { ref.current?.reset(); setPicked(new Set()); setTypeId(""); }
    return r;
  }, {});
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? workers.filter((w) => `${w.name} ${w.number}`.toLowerCase().includes(s)) : workers).slice(0, 200);
  }, [q, workers]);
  const e = state.errors ?? {};
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <form ref={ref} action={formAction} className="space-y-4" noValidate>
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
      <div className="space-y-1.5">
        <label htmlFor="rq-type" className="text-sm font-medium">Document</label>
        <NativeSelect id="rq-type" name="document_type_id" value={typeId} onChange={(ev) => setTypeId(ev.target.value)}>
          <option value="">Something else (describe it below)</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rq-title" className="text-sm font-medium">{typeId ? "Name shown to the worker (optional)" : "What do you need?"}{!typeId && <span className="text-danger"> *</span>}</label>
        <Input id="rq-title" name="title" maxLength={160} placeholder={typeId ? "Leave empty to use the type name" : "e.g. Bank statement, proof of address, diploma"} aria-invalid={!!e.title} />
        {e.title && <p className="text-sm text-danger">{e.title}</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rq-message" className="text-sm font-medium">Message to the worker</label>
        <Textarea id="rq-message" name="message" rows={3} maxLength={2000} placeholder="Why you need it and what it should show" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rq-due" className="text-sm font-medium">Due date</label>
        <Input id="rq-due" name="due_on" type="date" min={minDate} className="sm:w-48" />
      </div>

      {workerId ? (
        <input type="hidden" name="worker_ids" value={workerId} />
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Workers</legend>
          <input type="hidden" name="target" value={target} />
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-1 text-sm">
            {(["selected", "missing_required"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTarget(t)} aria-pressed={target === t}
                className={cn("rounded-md px-2 py-1.5 font-medium transition", target === t ? "bg-surface shadow-sm" : "text-muted-foreground")}>
                {t === "selected" ? "Choose workers" : "Everyone missing it"}
              </button>
            ))}
          </div>
          {target === "missing_required" ? (
            <p className="text-sm text-muted-foreground">Sends the request to every active or onboarding worker who has no current upload of the selected type{typeId ? "" : " — choose a type above"}.</p>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
                <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search name or number" className="pl-8" aria-label="Search workers" />
              </div>
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label="Workers">
                {shown.map((w) => (
                  <li key={w.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted">
                      <input type="checkbox" name="worker_ids" value={w.id} checked={picked.has(w.id)} onChange={() => toggle(w.id)} className="size-4 accent-primary" />
                      <span className="flex-1">{w.name}</span>
                      <span className="text-xs text-muted-foreground">{w.number}</span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No workers found</li>}
              </ul>
              <p className="text-xs text-muted-foreground">{picked.size} selected</p>
              {e.worker_ids && <p className="text-sm text-danger">{e.worker_ids}</p>}
            </>
          )}
        </fieldset>
      )}
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
      </div>
    </form>
  );
}
