import Link from "next/link";
import { Check } from "lucide-react";
import { BrandMark } from "@/components/layout/brand";

const POINTS = ["Plan and fill shifts in minutes", "Check-ins and timesheets without paperwork", "Invoices and payroll exports from approved hours"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-[#0a1a2e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_25rem_at_100%_0%,rgba(59,130,246,0.35),transparent),radial-gradient(30rem_20rem_at_0%_100%,rgba(14,165,233,0.25),transparent)]" />
        <Link href="/" className="relative flex items-center gap-2">
          <BrandMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">ShiftPilot</span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Your agency, clients and workers — on one platform.</h2>
          <ul className="mt-8 space-y-3 text-slate-300">
            {POINTS.map((p) => <li key={p} className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-emerald-500/20"><Check className="size-3.5 text-emerald-300" /></span>{p}</li>)}
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">Protected by row-level security and optional two-factor authentication.</p>
      </aside>
      <div className="flex flex-col items-center justify-center bg-background px-4 py-10">
        <Link href="/" className="mb-8 flex items-center gap-2 text-foreground lg:hidden">
          <BrandMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">ShiftPilot</span>
        </Link>
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-lg shadow-slate-900/5">{children}</div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:underline">Privacy notice</Link>
        </p>
      </div>
    </div>
  );
}
