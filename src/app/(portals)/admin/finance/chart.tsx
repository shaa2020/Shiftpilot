"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

export function RevenueCostChart({ data }: { data: { month: string; revenue: number; cost: number }[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground">No data in this period.</p>;
  return (
    <div className="h-72 w-full" role="img" aria-label="Invoiced revenue and estimated direct cost per month">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
          <YAxis tickFormatter={eur} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} width={80} />
          <Tooltip formatter={(v) => eur(Number(v))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }} />
          <Legend />
          <Bar dataKey="revenue" name="Invoiced revenue" fill="#2563EB" radius={[3, 3, 0, 0]} />
          <Bar dataKey="cost" name="Est. direct cost" fill="#94A3B8" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
