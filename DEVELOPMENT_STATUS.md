# Development status

_Last updated: 2026-11-17 · Branch: `claude/shiftpilot-production-dev-7enlb1`_

**Overall: Phases 1–3 complete; Phase 4 partially complete (database engine and worker portal done). Not ready for commercial release.**

## Completed

### Phase 1 — Foundation ✅
Schema for all domains, RLS on every table, roles/permissions, auth (sign-in, recovery, invitations), design system, portal shells, CI, documentation. See git history for details.

### Phase 2 — Admin HQ modules ✅
- Clients: list/search, create/edit/archive, locations, contacts, portal-user invitations with capabilities, contracts, **pricing (rate cards with approval and supersession)**.
- Workers: profile, identity/eligibility verification, skills, languages, certificates (verify/reject), availability, onboarding tasks, internal notes, employee pathway (contracts, wage rates), freelancer pathway (business, classification review, agreements, commercial rates).
- Database activation gate: a worker becomes active only after identity, eligibility and contract/classification checks (migration 0016). Automatic worker numbers and default onboarding tasks.
- Configuration: industries, categories, positions, skills, certificates, qualifications, position requirements.
- CRM pipeline with activities, follow-ups, ownership and conversion to client.
- Recruitment: openings, applications pipeline, interviews, screening, hiring into onboarding; public careers site with rate-limited intake, honeypot and content-checked CV upload to private storage.
- Secure signed-URL document download route.

### Phase 3 — Scheduling & matching ✅
- Eligibility engine with explanations (mandatory failures, warnings, notes, score) covering status, pathway, classification, contracts/agreements, identity and eligibility, regulated positions, requirements, overlap, unavailability and configurable working-time rules.
- Overrides only for warnings, with `matching.override` and a recorded reason; mandatory failures never overridable.
- Atomic RPCs: create shifts (weekly recurrence), accept/reject requests, invite, assign, confirm (re-check + immutable rate snapshot), cancel, no-show, replacement request and replacement.
- In-app notifications for all scheduling events.
- Admin UI: request review, shifts list/create/detail with matching panel, reschedule, duplicate, cancel, headcount; drag-and-drop calendar with filters and availability overlays.

### Phase 4 — Portals, attendance, timesheets (partial)
Done:
- Attendance engine (migration 0019): server-authoritative, idempotent check-in/out and breaks; offline device time kept separately and flagged; location stored only when the agency enabled it (geofence verification); staff entries.
- Timesheets generated at check-out and submitted; client approve/dispute; agency approval; dispute resolution; corrections (adjustments after approval — approved values never change); shift lifecycle follows attendance.
- Missing check-in / late alerts function; client projections (on duty, staff with check-in times, relevant certificates only); worker-only pay view.
- **Worker portal**: home (next shift, check-in/out with offline queue, hours this week/month, to-dos), offers (accept/decline/ask a question, eligible available shifts with "I'm interested"), schedule, shift detail (directions, instructions, attendance, own pay, timesheet, correction request, report absence), timesheets, profile (onboarding tasks, personal details, skills, languages, availability).

## Pending

| Area | Scope |
| --- | --- |
| Phase 4 (rest) | **Client portal pages** (create/cancel staffing requests, shifts with assigned staff and replacement requests, timesheet approval/dispute, team management); **admin timesheets and attendance pages** (approval queue, dispute resolution, correction decisions, live attendance board, staff entries); notifications bell/page; attendance alerts on the admin dashboard. The database functions for all of these exist and are tested. |
| Phase 5 — Finance | Invoice generation from approved timesheets (weekend/night/holiday rules from snapshots), issuing with numbering, PDF, email, credit notes, payments UI, payroll export, freelancer purchase-invoice workflow, financial reports. Schema and integrity rules exist and are tested. |
| Phase 6 — Documents & compliance | Upload UI (signed upload), verification queue, expiry reminders, compliance review UI, DSR export/retention jobs. |
| Phase 7 — PWA & automation | Service worker, push, WhatsApp, notification delivery worker, AI assistant. |
| Phase 8 — Production | Sentry, staff MFA, malware scanning, performance review, penetration test, backup rehearsal, deployment. |

## Known defects / limitations
- GitHub access was intermittently refused (403) during development; all commits through Phase 4 (part) are now pushed to `claude/shiftpilot-production-dev-7enlb1`.
- Signed-in browser flows have not been executed end-to-end (no Supabase Auth server available in the build sandbox); database behaviour is covered by the database suite.
- The calendar was verified to mount and request data, but not visually inspected with real data.
- Rate limiting fails open without `SUPABASE_SERVICE_ROLE_KEY`.
- Legal texts and compliance configuration require professional review.

## Tests (last local run)
| Suite | Result |
| --- | --- |
| Unit (Vitest) | 45 / 45 passed |
| Database (RLS, scheduling, matching, attendance, finance) | 81 / 81 passed |
| E2E smoke (Playwright, desktop + mobile) | 74 / 74 passed |
| Lint, typecheck, production build | passed |

## Deployment status
Not deployed. Awaiting: Supabase project (EU), hosting, service-role key, Resend, Sentry, custom SMTP.

## Next exact task
**Phase 4 — client portal:** `/client/requests` (list + new request form calling an insert as the client user with RLS; cancel), `/client/shifts` and `/client/shifts/[id]` (use `client_shift_staff`, `request_replacement`), `/client/timesheets` (use `client_review_timesheet`), `/client/team` (client invitations via `createInvitation`). Then `/admin/timesheets`, `/admin/attendance` and the notifications bell.
