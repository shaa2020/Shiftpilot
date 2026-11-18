# Development status

_Last updated: 2026-11-18 · Branch: `claude/shiftpilot-production-dev-7enlb1`_

**Overall: all eight build phases are implemented and tested locally. The product is NOT yet ready for commercial launch:
it has never been deployed, signed-in flows have not been run end-to-end against a real Supabase project, and the
launch gates below (legal review, penetration test, malware scanning, backup rehearsal) are open.**

## Completed

### Phase 1 — Foundation ✅
Schema for all domains, RLS on every table, roles/permissions, auth (sign-in, recovery, invitations), design system, portal shells, CI, documentation.

### Phase 2 — Admin HQ modules ✅
Clients (locations, contacts, portal users, contracts, rate cards with approval), workers (verification, skills, certificates, availability, onboarding, notes, employee and freelancer pathways), database activation gate, configuration, CRM, recruitment with public careers site.

### Phase 3 — Scheduling & matching ✅
Explainable eligibility engine, overrides for warnings only, atomic scheduling RPCs (recurrence, invite, assign, confirm with rate snapshot, cancel, no-show, replacement), notifications, admin shift/request UI and drag-and-drop calendar.

### Phase 4 — Portals, attendance, timesheets ✅
Server-authoritative attendance with offline queue and optional geofence, timesheets with client and agency approval, disputes and post-approval corrections; worker portal, client portal (requests, shifts, timesheets, team), admin timesheet and attendance boards, notification bell.

### Phase 5 — Finance ✅
Invoice generation from approved timesheets (weekend/night/holiday classification from snapshots, public holidays table), numbering on issue, PDF, email with attachment, credit notes, payments, payroll **data export** (CSV, no statutory calculations), freelancer purchase invoices matched to timesheets, financial overview.

### Phase 6 — Documents, compliance, GDPR ✅ (migration 0022)
- Uploads checked by file content (PDF/JPEG/PNG/WebP, 10 MB), versioned, stored privately; worker self-service checklist per pathway; staff uploads from the worker page.
- Verification queue with expiry capture; a new upload re-opens verification (also after rejection); linked certificates and qualifications follow the decision; workers are notified.
- Compliance: expiring evidence (60 days), regulated-position reviews, versioned rules with activation/retirement (working-time keys enforced by matching).
- Privacy: data subject requests (staff-logged and self-service from `/account`, officers notified), JSON subject export (audited), anonymisation of inactive workers and closed applications (records under legal retention kept without identifiers), processing register (versioned), retention schedule, breach register with 72-hour reminder.

### Phase 7 — PWA & automation ✅ (migration 0023)
- Delivery queue from in-app notifications by user preference: email for important events, push only with a registered device, WhatsApp opt-in. Retries with exponential backoff and dead-lettering. Providers that are not configured are recorded as `skipped_unconfigured`, never as sent.
- Cron endpoints protected by `CRON_SECRET`: dispatch (every 5 min) and automations (hourly): shift reminders, missing check-ins, document expiry warnings and expiry, overdue invoices, invitation expiry, applicant retention.
- Service worker: offline fallback page, static asset cache (signed-in pages are never cached), push display and click-through; notification preferences and device management.
- Read-only operations assistant (`/admin/assistant`) on the Claude API: tools query with the user's own RLS session, are filtered by permission, cannot change data; rate limited; "awaiting configuration" without `ANTHROPIC_API_KEY`.

### Phase 8 — Production preparation ✅ (code), launch gates open
- Server error reporting via `instrumentation.ts` `onRequestError` (structured logs; Sentry store endpoint when `SENTRY_DSN` is set; query strings and headers never sent).
- `/api/health` (Supabase reachability and which integrations are configured, never values).
- TOTP two-factor authentication for all users (enrol on `/account`, challenge on `/mfa`); once enrolled, every portal requires aal2; `ENFORCE_STAFF_MFA=true` makes it mandatory for staff.
- Security fixes found during this phase: SECURITY DEFINER functions no longer rely on `current_user` (always the owner there); tests scan for this and verify service-only grants.

### Post-phase hardening ✅ (migration 0024)
- Two-factor enforcement inside the database for staff, plus a per-agency "require staff MFA" setting with self-lockout guard.
- ClamAV malware scanning of all uploads (portal and careers site); scan status shown to verifiers.
- WhatsApp approved-template messages; UBL 2.1 / Peppol BIS 3 e-invoice export for accounting import.
- Opt-in geocoding (PDOK or Google) so travel-distance matching gets coordinates.
- Demo seed (`npm run seed:demo`) and signed-in E2E tests with a CI job on a local Supabase stack.

### Engagement & customisation ✅ (migration 0028)
- Branding per agency: logo, brand colour (applied to all three portals, light and dark), welcome messages for workers and clients, invoice footer; logo and colour also on invoice PDFs.
- Messaging: agency ↔ worker and agency ↔ client threads with unread badges, notifications, internal staff notes and auto-refresh.
- Announcements: agency posts to workers, clients, staff or everyone, with pinning and an end date; shown on home screens and notified.
- Clients rate finished shifts (1–5 stars) and mark workers preferred or blocked; matching excludes blocked and ranks preferred and well-rated workers higher. Staff see feedback on the worker record; workers see their own ratings.
- Workers subscribe to their shifts in Google/Apple/Outlook calendars via a private ICS link.
- CSV exports of workers, shifts and timesheets.

## Launch gates (not done — cannot be done from the build environment)

| Gate | Why it matters |
| --- | --- |
| Deploy to an EU Supabase project + hosting, apply migrations, bootstrap the first agency | Nothing is deployed yet |
| End-to-end test of signed-in flows against real Supabase Auth/Storage (invite → onboarding → shift → check-in → timesheet → invoice) | Only the database layer and signed-out pages are tested automatically |
| Legal review of privacy notice, retention periods, freelancer classification questions, invoice/VAT texts, compliance rule parameters | ShiftPilot records decisions; it does not make them legally sound |
| Independent penetration test | Internal review only so far |
| Host a ClamAV service and set `CLAMAV_HOST` | Scanning is implemented; without a scanner uploads are marked "not scanned" |
| First green run of the `e2e-supabase` CI job | Signed-in tests are written but have never executed |
| Backup and restore rehearsal (BACKUP_AND_RECOVERY.md) | Procedure documented, never executed |
| Load/performance test with realistic data volumes | Not measured |
| Configure Resend (verified domain), VAPID keys, WhatsApp templates, Sentry, custom SMTP for Supabase Auth | Integrations report "awaiting configuration" until then |

## Known limitations
- WhatsApp needs an approved template in Meta Business Manager (`WHATSAPP_TEMPLATE_NAME`); without one, plain text only delivers inside a 24-hour window.
- Accounting/payroll packages are integrated by file (UBL e-invoices, payroll CSV), not by live API connections.
- Payroll export is a data export for the payroll provider; ShiftPilot does not calculate tax, social security or holiday pay.
- Cron dispatch every 5 minutes needs a hosting plan that allows it (Vercel Pro); on lower plans set the schedule to daily or use an external scheduler.
- The assistant sends the user's question and the data it looks up to Anthropic; record this in the processing register before enabling it.
- Rate limiting fails open without `SUPABASE_SERVICE_ROLE_KEY`.
- The calendar and charts were verified to render, not visually reviewed with production data.

## Tests (last local run, 2026-11-18)
| Suite | Result |
| --- | --- |
| Unit (Vitest) | 77 / 77 passed (22 files) |
| Database (incl. MFA enforcement and engagement) | 115 / 115 passed (10 files) |
| Signed-in E2E against a local Supabase stack | 46 / 46 passed |
| E2E smoke (desktop + mobile) | 126 / 128 against a live stack; the 2 others check the "database unreachable" fallback and only apply without a database |
| Lint, typecheck, production build | passed |

## Deployment status
Deployed on Vercel (region dub1) against the agency's Supabase project. Remaining launch gates are listed above.

## Next exact task
Create the EU Supabase project and Vercel project, set the environment variables from ENVIRONMENT.md, run `supabase db push`, bootstrap the first agency (`scripts/bootstrap-agency.mjs`), then run the signed-in end-to-end checklist in TESTING.md § Manual acceptance.
