import { Search } from "lucide-react";
import { Input, NativeSelect } from "./input";
import { Button } from "./button";

/** GET-based filter bar: works without JavaScript and keeps filters in the URL. */
export function ListFilters({
  q,
  placeholder = "Search…",
  selects = [],
  hidden = {},
  showSearch = true,
}: {
  showSearch?: boolean;
  hidden?: Record<string, string>;
  q?: string;
  placeholder?: string;
  selects?: { name: string; label: string; value?: string; options: [string, string][] }[];
}) {
  return (
    <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {showSearch && (<div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" defaultValue={q} placeholder={placeholder} aria-label="Search" className="pl-8" />
      </div>)}
      {selects.map((s) => (
        <NativeSelect key={s.name} name={s.name} defaultValue={s.value ?? ""} aria-label={s.label} className="sm:w-48">
          <option value="">{s.label}: all</option>
          {s.options.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </NativeSelect>
      ))}
      <Button type="submit" variant="secondary">Filter</Button>
    </form>
  );
}

/** Escape user input used inside PostgREST `or=(...ilike...)` filters. */
export function ilikePattern(q: string): string {
  return `%${q.replace(/[%_\\,()*]/g, " ").trim()}%`;
}
