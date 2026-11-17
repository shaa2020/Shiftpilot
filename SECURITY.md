# Security

## Model

| Principal | Identified by | Scope |
| --- | --- | --- |
| Agency staff | `user_roles` (agency, role) → `role_permissions` | Their agency, limited to granted permissions |
| Client user | `client_memberships` (+ optional `client_membership_locations`) | Their client; capabilities `request`, `approve`, `finance`, `manage_users`; optionally specific locations |
| Worker | `workers.user_id` | Their own records only |
| Anonymous | — | Published job openings only |
| Service role | server-side key | Bypasses RLS; used only in server code for narrow, audited purposes |

Authorisation is enforced in four layers (see ARCHITECTURE.md): proxy, Data Access Layer, **PostgreSQL RLS** (final
authority) and database guard triggers.

## Controls implemented (Phase 1)

| Area | Control |
| --- | --- |
| Tenant isolation | `agency_id` on every tenant table, composite FKs, immutable `agency_id`, RLS helper functions (`app.has_permission`, `app.client_can`, `app.is_worker_self`, …) declared `SECURITY DEFINER` with an empty `search_path` |
| RLS coverage | All 108 tables; migration fails if one is missing; anonymous role has `SELECT` on `job_openings` only |
| Privilege escalation | Triggers prevent: workers changing status/pathway/verification fields; clients changing their own membership; non-owners granting/revoking ownership or inviting owners; removal of the last owner; self-approval of documents, credentials, freelancer classification and purchase invoices |
| Sensitive data | Identity/eligibility kept as statuses in `worker_private_details` (worker + `workers.sensitive.read` only); sensitive document types hidden from staff without that permission and never visible to clients; no BSN stored; internal notes in a staff-only table; clients receive a minimal projection of assigned workers (`client_shift_staff`) and never see wage rates, rate snapshots, cost profiles or margins |
| Financial integrity | Immutable issued invoices, append-only payments and rate snapshots, gapless numbering, invoice issuing requires `invoices.issue`, payment status derived — not settable |
| Audit | Append-only `audit_logs` (actor, old/new values, changed fields); IBANs and secrets redacted |
| Authentication | Supabase Auth; JWT validated server-side with `auth.getUser()`; passwords ≥ 12 chars; email confirmation; invitation-only onboarding; sign-in/sign-out/password-change events logged |
| Password recovery | Token-hash email links verified server-side; generic responses (no account enumeration); rate limited |
| Invitations | 256-bit random tokens; only SHA-256 hashes stored; 7-day expiry; single use; must match the signed-in email |
| Rate limiting | PostgreSQL-backed fixed windows shared across instances (`consume_rate_limit`); identifiers salted and hashed; Supabase Auth limits apply additionally |
| Input validation | Zod on every action; database `CHECK` constraints as second line |
| SQL injection | Only parameterised Supabase/PostgREST queries; no SQL string building in the app |
| XSS | React escaping; HTML emails escape all interpolated values; nonce-based CSP with `strict-dynamic` |
| CSRF | Server Actions (Next.js origin check); route handlers verify `Origin` |
| IDOR | Every lookup is filtered by RLS on the user's JWT; IDs from the client are never trusted for authorisation |
| Open redirects | `safeNextPath()` allows same-origin relative paths only |
| HTTP headers | CSP (per-request nonce), HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, strict referrer policy, Permissions-Policy, COOP; `X-Powered-By` removed; portal responses `Cache-Control: private, no-store` |
| Files | Private buckets; path `{agency}/{document}/…`; storage policies reuse the document read/upload rules; type detected from file content (PDF/JPEG/PNG/WebP only — HTML/SVG/executables rejected even if renamed), 10 MB limit; versions immutable; a new version re-opens verification |
| MFA | Supabase TOTP for every user; once enrolled, all portals require an aal2 session (`requireUser`); `ENFORCE_STAFF_MFA` makes enrolment mandatory for staff; verification attempts rate limited |
| Background jobs | `/api/cron/*` require `CRON_SECRET` (≥ 16 chars, constant-time comparison); queue/automation functions are executable by the service role only (tested) |
| SECURITY DEFINER | Guards never use `current_user` or `is_privileged()` inside definer functions (always the owner there); a test scans `pg_proc` for both |
| AI assistant | Read-only tools filtered by the user's permissions and executed with the user's RLS session; tool output treated as data; no write tools; rate limited (30/h) |
| Error reporting | Sentry events exclude headers, cookies, query strings and bodies |
| Secrets | Service role key only in server env; `server-only` imports make bundling it into client code a build error; integration secrets referenced by name (`secret_ref`), never stored in the database (a `CHECK` rejects secret-looking keys in `integration_accounts.config`) |
| Location privacy | Off by default; requires a published privacy notice (DB constraint); recorded only at check-in/out |

## Verified by tests

See TESTING.md. Highlights: client A cannot read client B; worker A cannot read worker B's records or documents;
clients cannot read wage rates or snapshots; unauthorised users cannot approve timesheets or issue invoices; duplicate
and concurrent acceptance are rejected; financial and audit records cannot be altered; anonymous users see only
published jobs; CSP and security headers are present; sign-out rejects cross-origin posts.

## Known gaps / pending

- MFA is enforced in the application layer (aal2 check), not yet in RLS policies; a stolen aal1 session token could
  still call the Data API directly. Adding `auth.jwt()->>'aal' = 'aal2'` to staff policies is recommended once all
  staff are enrolled.
- Malware scanning for uploads is not implemented (needs an external scanner, e.g. a storage webhook to ClamAV).
- `style-src 'unsafe-inline'` is allowed because Radix UI sets inline style attributes; scripts remain nonce-only.
- Rate limiting fails open if `SUPABASE_SERVICE_ROLE_KEY` is not configured (Supabase Auth limits still apply).
- An external penetration test is required before commercial launch.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the agency operating the deployment's security contact. Do not open
public issues for security reports.
