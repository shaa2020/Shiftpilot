# Environment variables

| Variable | Required | Exposure | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | browser + server | Supabase anon (publishable) key. Safe to expose: all access is governed by RLS |
| `NEXT_PUBLIC_APP_URL` | yes | browser + server | Public base URL, used in email links (e.g. `https://app.example.nl`) |
| `NEXT_PUBLIC_APP_ENV` | no (default `development`) | browser + server | `development`, `staging` or `production` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes in staging/production | **server only** | Bypasses RLS. Needed for invitation lookups, shared rate limiting, bootstrap and background jobs. Never prefix with `NEXT_PUBLIC_`, never log it |
| `IDENTIFIER_HASH_SALT` | recommended | server only | Long random string used to hash IPs/emails in rate-limit keys |
| `RESEND_API_KEY` | optional | server only | Enables transactional email |
| `EMAIL_FROM` | with Resend | server only | e.g. `ShiftPilot <no-reply@mail.example.nl>` (domain verified in Resend) |
| `SENTRY_DSN` | optional | server only | Sentry DSN; server errors are reported through `instrumentation.ts` `onRequestError` (no SDK, store endpoint) |
| `CRON_SECRET` | yes for scheduled jobs | server only | Bearer secret checked by `/api/cron/*` (Vercel Cron sends it automatically). At least 16 characters; without it the cron endpoints always return 401 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | browser + server | Web Push public key (`npx web-push generate-vapid-keys`) |
| `VAPID_PRIVATE_KEY` | with push | **server only** | Web Push private key |
| `VAPID_SUBJECT` | with push | server only | `mailto:ops@example.nl` or an https URL |
| `WHATSAPP_ACCESS_TOKEN` | optional | **server only** | WhatsApp Business Cloud API token; deliveries are opt-in per user |
| `WHATSAPP_PHONE_NUMBER_ID` | with WhatsApp | server only | Sending phone number id |
| `ANTHROPIC_API_KEY` | optional | **server only** | Enables the read-only operations assistant (`/admin/assistant`). Questions and looked-up data are sent to Anthropic — record this in the processing register |
| `ENFORCE_STAFF_MFA` | no (default `false`) | server only | When `true`, agency staff must enrol and use TOTP MFA before opening Admin HQ |

Test-only variables:

| Variable | Default | Used by |
| --- | --- | --- |
| `DATABASE_ADMIN_URL` | `postgres://postgres@127.0.0.1:54329/postgres` | `scripts/db-reset.sh` |
| `TEST_DATABASE_URL` | `postgres://postgres@127.0.0.1:54329/shiftpilot_test` | DB tests, type generation |
| `PW_CHROMIUM_PATH` | — | Playwright: use a pre-installed Chromium |
| `E2E_PORT` | `3100` | Playwright web server port |

## Files

- `.env.example` — template (committed).
- `.env.local` — local values (git-ignored). Next.js loads it automatically.
- Hosting provider settings — staging and production values. Keep production secrets out of developer machines where possible.

## Validation

`src/lib/env.ts` validates the public variables with Zod on first use and reports which are missing. Optional
integrations are read lazily: when absent, the related feature reports **"awaiting configuration"** instead of failing.

## Rotating secrets

1. Generate the new key in the provider (Supabase: *Project Settings → API → Rotate*).
2. Update the hosting environment variables and redeploy.
3. Revoke the old key. Record the rotation in your operations log.
