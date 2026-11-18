import Link from "next/link";
import {
  ArrowRight, BadgeCheck, Bell, Bot, Building2, CalendarDays, Check, ClipboardCheck, Clock3, FileCheck2, FileText,
  Fingerprint, HardHat, LineChart, Lock, MapPin, MessageCircle, Receipt, ScrollText, ShieldCheck, Smartphone, Users, WifiOff,
} from "lucide-react";
import { BrandMark } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { InstallApp } from "@/components/layout/install-app";

const FLOW = [
  { Icon: Building2, title: "Request", text: "The client asks for 6 waiters on Saturday from its portal." },
  { Icon: Users, title: "Match", text: "Only eligible, available workers are suggested — with the reasons." },
  { Icon: Smartphone, title: "Confirm", text: "Workers accept on their phone; rates are locked at confirmation." },
  { Icon: MapPin, title: "Check in", text: "Server-timed check-in and breaks, also offline, optional geofence." },
  { Icon: ClipboardCheck, title: "Approve", text: "Timesheet built automatically; client and agency approve." },
  { Icon: Receipt, title: "Invoice & pay", text: "Invoice with weekend/night rules, payroll export, freelancer payout." },
];

const PORTALS = [
  {
    Icon: LineChart, name: "Admin HQ", who: "Agency team",
    points: ["Live dashboard and attendance board", "Drag-and-drop schedule with matching", "CRM, recruitment and onboarding", "Invoices, payroll export, freelancer invoices", "Compliance, documents and privacy tools", "AI operations assistant (read-only)"],
  },
  {
    Icon: Building2, name: "Client portal", who: "Your customers",
    points: ["Request staff per location and position", "See who is coming and who is on site", "Approve or dispute hours", "Invoices as PDF and e-invoice (UBL)", "Manage their own team access"],
  },
  {
    Icon: HardHat, name: "Worker app", who: "Employees & freelancers",
    points: ["Shift offers with one-tap accept", "Check in/out, works offline", "Directions and site instructions", "Own hours, pay and documents", "Push, email or WhatsApp alerts"],
  },
  {
    Icon: Users, name: "Careers site", who: "Applicants",
    points: ["Public job openings per agency", "Apply with CV in two minutes", "Recruitment pipeline and interviews", "Hire straight into onboarding"],
  },
];

const CAPABILITIES = [
  { Icon: CalendarDays, title: "Scheduling", text: "Recurring shifts, headcount per position, replacements, no-shows and a calendar your planners can drag." },
  { Icon: BadgeCheck, title: "Explainable matching", text: "Every suggestion shows why: certificates, availability, rest time, travel distance, pathway rules." },
  { Icon: Users, title: "Employees and freelancers", text: "Two separate pathways — contracts and wages vs. businesses, agreements and purchase invoices." },
  { Icon: Clock3, title: "Attendance", text: "Server time, idempotent offline queue, breaks, late and missing check-in alerts." },
  { Icon: ClipboardCheck, title: "Timesheets", text: "Generated at check-out, client and agency approval, disputes and audited corrections." },
  { Icon: Receipt, title: "Invoicing", text: "Weekend, night and holiday rules from locked rate snapshots, credit notes, payments." },
  { Icon: FileCheck2, title: "Documents", text: "Uploads checked by content and virus-scanned, verification queue, expiry reminders." },
  { Icon: ScrollText, title: "Compliance", text: "Versioned working-time rules, regulated-position reviews, freelancer classification records." },
  { Icon: Bell, title: "Notifications", text: "In-app, email, push and WhatsApp, with each user choosing their own channels." },
  { Icon: WifiOff, title: "Installable app", text: "Works as a phone app with an offline page; check-ins sync when the signal returns." },
  { Icon: Bot, title: "AI assistant", text: "Ask “which shifts this week are unfilled?” — it answers from data you may see, never changes it." },
  { Icon: FileText, title: "Exports", text: "Invoice PDF and UBL for Exact, Moneybird, AFAS; payroll CSV for your payroll provider." },
];

const TRUST = [
  { Icon: Lock, title: "Tenant isolation", text: "Row-level security on every table — clients, workers and agencies only ever see their own data." },
  { Icon: Fingerprint, title: "Two-factor login", text: "Authenticator-app MFA, enforced by the database for staff when your agency requires it." },
  { Icon: ShieldCheck, title: "Tamper-proof finance", text: "Issued invoices, payments and approved hours cannot be edited; every change is audited." },
  { Icon: ScrollText, title: "GDPR tooling", text: "Data requests, exports, anonymisation, retention, processing register and breach log." },
];

/** Illustrative product view built from the real design system (example values). */
function ProductPreview() {
  const shifts = [
    { t: "07:00", title: "Housekeeping", where: "Hotel, Utrecht", fill: "3/3", tone: "bg-success" },
    { t: "15:00", title: "Order picking", where: "DC Nieuwegein", fill: "2/4", tone: "bg-warning" },
    { t: "17:30", title: "Banqueting", where: "Hotel, Utrecht", fill: "5/6", tone: "bg-warning" },
    { t: "22:00", title: "Night shift", where: "DC Nieuwegein", fill: "0/3", tone: "bg-danger" },
  ];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-xl lg:max-w-none">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-sky-400/30 via-blue-500/20 to-indigo-500/30 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1d31] shadow-2xl ring-1 ring-black/20">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-red-400/80" /><span className="size-2.5 rounded-full bg-amber-400/80" /><span className="size-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-3 text-xs text-slate-400">Admin HQ · Dashboard</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {[
            ["Shifts today", "18", "+3 vs. last week"],
            ["On site now", "41", "2 late check-ins"],
            ["Hours to approve", "126", "9 timesheets"],
          ].map(([k, v, s]) => (
            <div key={k} className="rounded-xl bg-white/5 p-3">
              <p className="text-[11px] text-slate-400">{k}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{v}</p>
              <p className="text-[11px] text-slate-400">{s}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-5">
          <div className="rounded-xl bg-white/5 p-3 sm:col-span-3">
            <p className="mb-2 text-xs font-medium text-slate-300">Today&apos;s shifts</p>
            <ul className="space-y-2">
              {shifts.map((s) => (
                <li key={s.t + s.title} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                  <span className="w-11 text-xs tabular-nums text-slate-400">{s.t}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{s.title}</span>
                    <span className="block truncate text-[11px] text-slate-400">{s.where}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-slate-300"><span className={`size-2 rounded-full ${s.tone}`} />{s.fill}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3 sm:col-span-2">
            <div className="rounded-xl bg-white/5 p-3">
              <p className="mb-2 text-xs font-medium text-slate-300">Best matches · Night shift</p>
              {[["Daan B.", "96"], ["Sanne J.", "91"], ["Ali K.", "87"]].map(([n, sc]) => (
                <div key={n} className="flex items-center justify-between py-1 text-sm text-white">
                  <span className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-blue-500/30 text-[10px]">{n[0]}</span>{n}</span>
                  <span className="text-xs text-emerald-300">{sc}%</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <p className="mb-1 text-xs font-medium text-slate-300">Revenue this month</p>
              <div className="flex h-14 items-end gap-1">
                {[35, 48, 42, 60, 55, 72, 66, 80, 76, 90].map((h, i) => (
                  <span key={i} className="flex-1 rounded-sm bg-gradient-to-t from-blue-600 to-sky-400" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-4 hidden w-56 rounded-2xl border border-white/10 bg-white p-3 shadow-xl sm:block">
        <p className="text-[11px] font-medium text-slate-500">Worker app</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">Housekeeping · 07:00</p>
        <p className="text-[11px] text-slate-500">Domplein 9, Utrecht</p>
        <span className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white"><MapPin className="size-3.5" />Check in</span>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-dvh bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden bg-[#0a1a2e] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_80%_-10%,rgba(59,130,246,0.35),transparent),radial-gradient(40rem_25rem_at_-10%_110%,rgba(14,165,233,0.25),transparent)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:48px_48px]" />
        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
          <div className="flex items-center gap-2">
            <BrandMark className="size-8" />
            <span className="text-lg font-semibold tracking-tight">ShiftPilot</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#portals" className="hover:text-white">Portals</a>
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#security" className="hover:text-white">Security</a>
          </nav>
          <Button asChild variant="secondary" className="border-white/15 bg-white/10 text-white hover:bg-white/20">
            <Link href="/login">Sign in</Link>
          </Button>
        </header>
        <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-10 lg:grid-cols-2 lg:pt-16">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-sky-200">
              <span className="size-1.5 rounded-full bg-emerald-400" /> Built for Dutch staffing agencies
            </p>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              From client request to <span className="bg-gradient-to-r from-sky-300 to-blue-400 bg-clip-text text-transparent">paid invoice</span> — in one system.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-300">
              Plan shifts, match the right people, track attendance, approve hours and invoice automatically. With separate portals for your team, your clients and your workers.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-blue-500 hover:bg-blue-400">
                <Link href="/login">Sign in <ArrowRight /></Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                <a href="#how">See how it works</a>
              </Button>
              <InstallApp className="h-12 border-white/15 bg-white/5 px-6 text-base text-white hover:bg-white/10" label="Install the app" />
            </div>
            <ul className="mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-3 text-sm text-slate-300">
              {["Employees and freelancers", "Works offline on phones", "Invoices with night & weekend rules", "GDPR and audit built in"].map((t) => (
                <li key={t} className="flex items-center gap-2"><Check className="size-4 text-emerald-400" />{t}</li>
              ))}
            </ul>
          </div>
          <ProductPreview />
        </section>
      </div>

      <main>
        {/* Flow */}
        <section id="how" className="mx-auto max-w-6xl px-4 py-20">
          <p className="text-sm font-semibold text-primary">How it works</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight">One flow, no spreadsheets, no WhatsApp chaos.</h2>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {FLOW.map(({ Icon, title, text }, i) => (
              <li key={title} className="relative rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <span className="absolute right-4 top-4 text-xs font-semibold text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <span className="inline-flex rounded-xl bg-primary-soft p-2.5 text-primary-soft-foreground"><Icon className="size-5" aria-hidden /></span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Portals */}
        <section id="portals" className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <p className="text-sm font-semibold text-primary">Four portals</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight">Everyone gets their own view — and only their own data.</h2>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {PORTALS.map(({ Icon, name, who, points }) => (
                <div key={name} className="flex flex-col rounded-2xl border border-border bg-background p-6">
                  <span className="inline-flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow"><Icon className="size-5" aria-hidden /></span>
                  <h3 className="mt-4 text-lg font-semibold">{name}</h3>
                  <p className="text-sm text-muted-foreground">{who}</p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{p}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-20">
          <p className="text-sm font-semibold text-primary">Features</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight">Everything an agency runs on, in depth.</h2>
          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"><Icon className="size-5" aria-hidden /></span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Security */}
        <section id="security" className="bg-[#0a1a2e] text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 lg:grid-cols-3">
            <div>
              <p className="text-sm font-semibold text-sky-300">Security & compliance</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Built so mistakes and misuse are hard by design.</h2>
              <p className="mt-4 text-slate-300">Rules live in the database, not just the screen — so they hold for every portal, every integration and every user.</p>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-2">
              {TRUST.map(({ Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <Icon className="size-5 text-sky-300" aria-hidden />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-slate-300">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 py-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-gradient-to-r from-blue-600 to-sky-500 p-8 text-white shadow-lg sm:p-12 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ready when your team is.</h2>
              <p className="mt-2 max-w-xl text-blue-50">Accounts are created by invitation from your agency. Already invited? Sign in to get started.</p>
            </div>
            <Button asChild size="lg" variant="secondary" className="bg-white text-blue-700 hover:bg-blue-50">
              <Link href="/login">Sign in <ArrowRight /></Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><BrandMark className="size-5" /> © {new Date().getFullYear()} ShiftPilot</span>
          <span className="flex items-center gap-5">
            <span className="flex items-center gap-1.5"><MessageCircle className="size-4" aria-hidden />Questions? Ask your agency</span>
            <Link href="/privacy" className="hover:text-foreground">Privacy notice</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
