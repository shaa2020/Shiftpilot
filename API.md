# API

ShiftPilot exposes no separate REST API of its own. Clients interact through:

1. **Next.js Server Actions and Route Handlers** (this document, section A), which authenticate the user, validate input
   with Zod and then talk to Supabase as that user.
2. **Supabase Data API (PostgREST)** on the user's JWT — every table is protected by RLS, so direct API access by a
   signed-in user is limited to exactly what the policies allow.
3. **Database RPC functions** (section B) for operations that must be atomic.

## A. Server Actions and Route Handlers

| Location | Action | Who | Notes |
| --- | --- | --- | --- |
| `app/(auth)/actions.ts` | `signInAction` | anyone | Zod validation, shared rate limit (10 / 15 min per IP+email), generic error message, records `user_sessions` |
| | `requestPasswordResetAction` | anyone | Rate limited (5 / h); identical response whether or not the account exists |
| | `updatePasswordAction` | recovery session | Password policy: 12–128 chars |
| | `signUpFromInvitationAction` | invitee | Only reachable from a valid invitation link; rate limited |
| `app/invite/[token]/actions.ts` | `acceptInvitationAction` | signed-in invitee | Calls `accept_invitation()` |
| `app/(portals)/admin/settings/actions.ts` | `updateAgencySettingsAction` | `agency.settings.manage` | IBAN checksum, KvK/VAT format, location-privacy rule |
| `app/(portals)/admin/settings/team/actions.ts` | `inviteStaffAction` | `users.manage` | 256-bit token, only the SHA-256 hash stored, 7-day expiry; emailed via Resend when configured, otherwise the link is shown once to the inviter |
| | `revokeInvitationAction`, `removeRoleAction` | `users.manage` | Owner role protected by database triggers |
| `app/(portals)/account/actions.ts` | `updateProfileAction`, `changePasswordAction` | signed-in user | Own profile only |
| `app/auth/confirm/route.ts` | `GET` | email link | Verifies Supabase `token_hash` (signup, invite, recovery, email change); redirect target sanitised |
| `app/auth/signout/route.ts` | `POST` | signed-in user | Same-origin check (CSRF) |

Server Actions are protected against CSRF by Next.js (POST-only, Origin/Host comparison). All redirects pass through
`safeNextPath()` to prevent open redirects.

## B. Database RPC functions

| Function | Callable by | Purpose |
| --- | --- | --- |
| `my_permissions(agency_id)` | authenticated | The caller's effective permissions in an agency (UI hints only) |
| `accept_invitation(token)` | authenticated | Validates token hash, expiry, single use and email match; creates the staff role, client membership or worker link atomically |
| `respond_to_shift_invitation(invitation_id, accept, reason?)` | the invited worker | Accept/decline a broadcast offer; acceptance creates the assignment — headcount, double-booking and pathway rules enforced in the same transaction |
| `respond_to_assignment(assignment_id, accept, reason?)` | the assigned worker | Accept/decline a direct assignment |
| `client_shift_staff(shift_id)` | client users (and staff) | Privacy-preserving staff list: display name, position, status only |
| `log_audit_event(...)` | agency members, service role | Explicit audit entries (e.g. "invoice emailed") |
| `bootstrap_agency(name, slug, owner)` | service role | Creates a tenant with defaults and its owner |
| `consume_rate_limit(key, limit, window)` / `purge_rate_limits()` | service role | Shared fixed-window rate limiting |
| `claim_automation_jobs(worker, limit)` / `claim_notification_deliveries(limit)` | service role | Queue consumers using `FOR UPDATE SKIP LOCKED` |

Errors raised by database rules use SQLSTATE `P0001` (business rule), `P0002` (not found) or `42501` (not authorised)
with human-readable messages that the UI can display.

## C. Route handlers added in later phases

| Route | Who | Notes |
| --- | --- | --- |
| `GET /api/documents/[id]` | anyone who may read the document (RLS) | Redirect to a 2-minute signed URL; download audited |
| `GET /api/invoices/[id]/pdf` | finance staff / client finance users (RLS) | Generated PDF of the invoice |
| `GET /api/payroll-exports/[id]` | `payroll.export` | CSV, formula-injection safe |
| `GET /api/privacy/export?email=` | `gdpr.manage` | JSON subject export, audited |
| `GET /api/cron/dispatch` | cron (`Authorization: Bearer $CRON_SECRET`) | Sends queued email/push/WhatsApp deliveries |
| `GET /api/cron/automations` | cron | Runs `run_scheduled_automations()` |
| `GET /api/health` | public | Status and which integrations are configured (booleans only) |

## D. RPC functions added in later phases

Scheduling (0017): `create_shifts`, `accept_shift_request`, `reject_shift_request`, `invite_workers`, `assign_worker`,
`confirm_assignment`, `cancel_assignment`, `mark_no_show`, `request_replacement`, `replace_assignment`,
`withdraw_invitation`, `find_eligible_workers`, `evaluate_worker_eligibility`.
Attendance (0019): `record_attendance` (idempotency key, offline device time, optional location), `staff_record_attendance`,
`client_review_timesheet`, `agency_approve_timesheet`, `resolve_timesheet_dispute`, `decide_attendance_correction`,
`attendance_alerts`, `worker_available_shifts`, `express_shift_interest`, `my_assignment_pay`, `client_on_duty`.
Finance (0021): `timesheet_billing_preview`, `generate_client_invoice`, `issue_invoice`, `create_credit_note`,
`record_invoice_sent`, `generate_payroll_export`, `submit_freelancer_invoice`, `review_freelancer_invoice`,
`mark_freelancer_invoice_paid`, `financial_summary`.
Documents/GDPR (0022): `verify_document`, `worker_document_checklist`, `decide_compliance_review`, `export_subject_data`,
`anonymise_application`, `anonymise_worker`, `my_agencies`, `apply_retention` (service role).
Automation (0023): `register_push_subscription`; service role only: `complete_notification_delivery`,
`delivery_context`, `run_scheduled_automations`.

The operations assistant (`/admin/assistant`) has no API of its own: its tools are read-only queries executed with the
signed-in user's Supabase session (`src/lib/assistant/tools.ts`).
