"use client";
import { useRef, useState, useTransition } from "react";
import { Bot, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; text: string; tools?: string[] };
type Result = { ok: true; text: string; toolsUsed: string[] } | { ok: false; message: string };

const SUGGESTIONS = ["Which shifts this week still have open positions?", "Who is late for check-in right now?", "Which timesheets are waiting for approval?", "Which certificates expire in the next 30 days?"];

export function AssistantChat({ ask }: { ask: (history: { role: "user" | "assistant"; text: string }[]) => Promise<Result> }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const next = [...turns, { role: "user" as const, text: q }];
    setTurns(next);
    setInput("");
    setError(null);
    start(async () => {
      const res = await ask(next.slice(-20).map(({ role, text }) => ({ role, text })));
      if (res.ok) setTurns((t) => [...t, { role: "assistant", text: res.text, tools: res.toolsUsed }]);
      else setError(res.message);
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => <Button key={s} type="button" variant="secondary" size="sm" onClick={() => send(s)}>{s}</Button>)}
        </div>
      )}
      <ol className="space-y-3" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className={cn("flex gap-3 rounded-lg p-3 text-sm", t.role === "assistant" ? "bg-muted" : "")}>
            {t.role === "assistant" ? <Bot className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Assistant" /> : <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="You" />}
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              {t.tools && t.tools.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Looked up: {[...new Set(t.tools)].join(", ")}</p>}
            </div>
          </li>
        ))}
        {pending && <li className="p-3 text-sm text-muted-foreground">Looking this up…</li>}
      </ol>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div ref={end} />
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <Textarea aria-label="Ask the assistant" value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000} placeholder="Ask about shifts, attendance, timesheets, documents…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <Button type="submit" disabled={pending || !input.trim()} aria-label="Send"><Send className="size-4" /></Button>
      </form>
    </div>
  );
}
