import type { Permission } from "@/lib/auth/permissions";

export type NavIcon =
  | "dashboard" | "settings" | "users" | "shield" | "briefcase" | "calendar" | "clock" | "receipt" | "home" | "file" | "bell"
  | "building" | "hardhat" | "target" | "megaphone" | "sliders";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Visible when the user holds ANY of these (empty = always). */
  anyOf?: Permission[];
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * Only routes that are implemented appear here — no placeholder links.
 * Modules are added as each roadmap phase ships (see DEVELOPMENT_STATUS.md).
 */
export const ADMIN_NAV: NavSection[] = [
  { items: [{ href: "/admin", label: "Dashboard", icon: "dashboard", anyOf: ["dashboard.view"] }] },
  {
    label: "Operations",
    items: [
      { href: "/admin/requests", label: "Staffing requests", icon: "bell", anyOf: ["requests.read"] },
      { href: "/admin/shifts", label: "Shifts", icon: "briefcase", anyOf: ["shifts.read"] },
      { href: "/admin/schedule", label: "Schedule", icon: "calendar", anyOf: ["shifts.read"] },
      { href: "/admin/attendance", label: "Attendance", icon: "clock", anyOf: ["attendance.read"] },
      { href: "/admin/timesheets", label: "Timesheets", icon: "file", anyOf: ["timesheets.read"] },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/admin/crm", label: "CRM", icon: "target", anyOf: ["crm.read"] },
      { href: "/admin/clients", label: "Clients", icon: "building", anyOf: ["clients.read"] },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/admin/workers", label: "Workers", icon: "hardhat", anyOf: ["workers.read"] },
      { href: "/admin/recruitment", label: "Recruitment", icon: "megaphone", anyOf: ["recruitment.read"] },
      { href: "/admin/documents", label: "Documents", icon: "file", anyOf: ["documents.read"] },
      { href: "/admin/compliance", label: "Compliance", icon: "shield", anyOf: ["compliance.read"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/admin/finance", label: "Overview", icon: "dashboard", anyOf: ["finance.read"] },
      { href: "/admin/invoices", label: "Invoices", icon: "receipt", anyOf: ["finance.read"] },
      { href: "/admin/payroll", label: "Payroll exports", icon: "file", anyOf: ["payroll.export"] },
      { href: "/admin/purchase-invoices", label: "Freelancer invoices", icon: "receipt", anyOf: ["finance.read", "purchase_invoices.approve"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/settings", label: "Agency settings", icon: "settings", anyOf: ["agency.settings.manage"] },
      { href: "/admin/configuration", label: "Configuration", icon: "sliders" },
      { href: "/admin/settings/team", label: "Team & access", icon: "users", anyOf: ["users.manage"] },
      { href: "/admin/settings/roles", label: "Roles & permissions", icon: "shield", anyOf: ["users.manage", "roles.manage"] },
      { href: "/admin/privacy", label: "Privacy", icon: "shield", anyOf: ["gdpr.manage"] },
      { href: "/admin/audit-log", label: "Audit log", icon: "file", anyOf: ["audit.read"] },
    ],
  },
];

export interface ClientNavCaps { request: boolean; approve: boolean; finance: boolean; manageUsers: boolean }

export const CLIENT_NAV: NavSection[] = [
  {
    items: [
      { href: "/client", label: "Overview", icon: "dashboard" },
      { href: "/client/requests", label: "Staffing requests", icon: "bell" },
      { href: "/client/shifts", label: "Shifts", icon: "calendar" },
      { href: "/client/timesheets", label: "Timesheets", icon: "clock" },
      { href: "/client/invoices", label: "Invoices", icon: "receipt" },
      { href: "/client/pricing", label: "Pricing", icon: "file" },
      { href: "/client/team", label: "Team", icon: "users" },
    ],
  },
];

/** Client navigation filtered by membership capabilities (UI only; RLS enforces access). */
export function clientNav(caps: ClientNavCaps): NavSection[] {
  const hide = new Set<string>();
  if (!caps.manageUsers) hide.add("/client/team");
  if (!caps.finance) {
    hide.add("/client/invoices");
    hide.add("/client/pricing");
  }
  return CLIENT_NAV.map((s) => ({ ...s, items: s.items.filter((i) => !hide.has(i.href)) }));
}

export const WORKER_NAV: NavSection[] = [
  {
    items: [
      { href: "/worker", label: "Home", icon: "home" },
      { href: "/worker/offers", label: "Offers", icon: "bell" },
      { href: "/worker/schedule", label: "My schedule", icon: "calendar" },
      { href: "/worker/timesheets", label: "Timesheets", icon: "clock" },
      { href: "/worker/earnings", label: "Earnings", icon: "receipt" },
      { href: "/worker/documents", label: "Documents", icon: "file" },
      { href: "/worker/profile", label: "My profile", icon: "users" },
    ],
  },
];

export function filterNav(sections: NavSection[], granted: ReadonlySet<string>): NavSection[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.anyOf || i.anyOf.length === 0 || i.anyOf.some((p) => granted.has(p))) }))
    .filter((s) => s.items.length > 0);
}
