# Testing

## Suites

| Suite | Command | Runs against | Count (last local run) |
| --- | --- | --- | --- |
| Unit | `npm test` | Node (Vitest) | 69 tests, 21 files — passing |
| Database (RLS, scheduling, matching, attendance, finance, invoicing, compliance/GDPR, automation, MFA) | `npm run test:db` | PostgreSQL 16 + Supabase shim, all migrations applied from scratch | 103 tests, 8 files — passing |
| E2E smoke | `npm run test:e2e` | Production build (`next start`) in Chromium, desktop + Pixel 7 | 128 tests (64 × 2 viewports) — passing |
| Signed-in E2E | `npm run test:e2e:auth` | Local Supabase stack (`supabase start`) + `npm run seed:demo` | 6 flows (owner, planner, client, worker, freelancer, account) — run by the `e2e-supabase` CI job; **not yet executed** (needs Docker image pulls, blocked in the build sandbox) |
| Static checks | `npm run lint`, `npm run typecheck` | ESLint, TypeScript strict | passing |
| Production build | `npm run build` | Next.js 16 (Turbopack) | passing |

Last local run: 2026-11-17. CI runs all of the above on every change (DEPLOYMENT.md § CI/CD) and additionally applies
the migrations to the real Supabase database stack.

## How the database tests work

`scripts/db-reset.sh` drops and recreates `shiftpilot_test`, applies `supabase/test-support/supabase_shim.sql`
(roles `anon` / `authenticated` / `service_role`, `auth.uid()`, `auth.jwt()`, minimal `auth.users` and `storage`
schemas — the same surface Supabase provides) and then every migration in order.

Tests build fixtures as the superuser (two agencies, staff with different roles, a custom role, three clients with
full and location-restricted users, employee and freelancer workers), then impersonate users exactly as PostgREST does:
`SET LOCAL ROLE authenticated` plus `request.jwt.claims`. Each impersonated block runs in a transaction that is rolled
back. Concurrency tests use separate connections that commit.

Local PostgreSQL without Docker:

```bash
initdb -D .local/pgdata -U postgres --auth=trust
pg_ctl -D .local/pgdata -o "-p 54329 -k /tmp" -l .local/pg.log start
npm run test:db
```

## Required security scenarios — coverage

| Scenario (specification §22) | Test |
| --- | --- |
| Client A cannot access Client B | `security.test.ts` › client isolation |
| Worker A cannot access Worker B | `security.test.ts` › worker isolation |
| Client cannot access internal wage rates | `security.test.ts` › client users cannot read workers, wage rates… |
| Worker cannot access another worker's documents | `security.test.ts` › Worker A cannot access Worker B's records or documents |
| Unauthorised user cannot approve timesheets | `finance.test.ts` › unauthorised users cannot approve timesheets |
| Unauthorised user cannot issue invoices | `finance.test.ts` › a user without invoices.issue cannot issue invoices |
| Duplicate shift acceptance is rejected | `scheduling.test.ts` › duplicate shift acceptance is rejected |
| Conflicting assignments are rejected | `scheduling.test.ts` › conflicting (overlapping) assignments; rescheduling into a conflict |
| Financial records cannot be altered without an audit trail | `finance.test.ts` › issued invoices immutable, payments append-only, changes audited; `security.test.ts` › audit log cannot be altered |

Additional coverage: agency tenant isolation (read/write/move/cross-tenant FK), anonymous access, privilege-escalation
guards (workers, client memberships, owner role), sensitive-document visibility, invitations (email match, single use,
owner-only owner invites), pathway separation, state machines, real concurrent acceptance of the last slot (exactly one
succeeds), headcount, engagement restrictions, invoice totals and VAT rounding, gapless numbering, payment-derived
status, rate immutability and non-overlap, approved-timesheet immutability, server-authoritative attendance time and
idempotency, freelancer purchase-invoice guards, rate limiting, document verification (verifier-only, expiry
required, re-open on new upload, workers cannot self-verify), compliance review decisions, subject export (privacy
officers only, audited), anonymisation and retention, self-service data requests, delivery queue preferences, backoff
and dead-lettering, scheduled automations idempotency, service-only grants, SECURITY DEFINER guard scan.

Unit tests: permission catalogue equals the database seed, navigation contains no dead links, portal resolution,
open-redirect protection, CSP builder, time-zone/DST handling, Dutch IBAN/KvK/VAT validation, auth validation, email
adapter (never reports delivery without a provider id; HTML escaping), upload content detection, assistant tools
(permission filtering, input validation, no write tools), cron authorisation, Sentry DSN parsing and scrubbing.

E2E smoke: landing and privacy pages, 404, signed-out redirects for every portal with a safe `next` parameter,
expired recovery and invalid invitation handling, sign-out CSRF rejection, form validation and ARIA error wiring,
nonce-based CSP with a fresh nonce per request, absence of CSP violations, security headers, PWA manifest, no
horizontal overflow on mobile, every new portal route redirects when signed out, cron endpoints reject missing/wrong
secrets, privacy export requires a session, service worker and offline page served, health endpoint exposes no values,
MFA challenge requires a session.

## Not yet covered (honest status)

- **Signed-in browser flows** are written (`tests/e2e-auth`) and wired into the `e2e-supabase` CI job, but have not
  run yet: the build sandbox cannot pull Supabase container images. The first CI run on GitHub will execute them.
- Real provider calls (Resend, Web Push, WhatsApp, Anthropic, Sentry) are not exercised in tests; adapters are tested
  for their "not configured" and error paths only.
- Service-worker offline behaviour and push display are not automated (served files are checked).

## Manual acceptance (run on staging before launch)

1. Bootstrap agency → owner accepts invite → enable MFA → complete agency settings.
2. Invite a client user and a worker; worker uploads ID/certificate on `/worker/documents`; verify in `/admin/documents`.
3. Activate the worker; client creates a staffing request; agency converts it into a shift and invites the worker.
4. Worker accepts, receives the reminder (push/email), checks in (also once offline), takes a break, checks out.
5. Client approves the timesheet; agency approves; generate, issue and email the invoice; record a payment.
6. Generate a payroll export; freelancer submits and gets paid for a purchase invoice.
7. File a data request from `/account`; export and close it in `/admin/privacy`.
8. Ask the assistant "Which shifts this week are unfilled?" and compare with `/admin/shifts`.
