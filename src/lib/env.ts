import { z } from "zod";

/**
 * Environment validation. Public values are inlined at build time by Next.js
 * (NEXT_PUBLIC_*). Server values are read lazily so that a missing optional
 * integration never prevents the app from starting.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

let cachedPublic: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}. See ENVIRONMENT.md.`,
    );
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

/** Optional server-side integration settings. Absent values mean "awaiting configuration". */
export const serverEnv = {
  supabaseServiceRoleKey: () => process.env.SUPABASE_SERVICE_ROLE_KEY,
  resendApiKey: () => process.env.RESEND_API_KEY,
  emailFrom: () => process.env.EMAIL_FROM,
  sentryDsn: () => process.env.SENTRY_DSN,
  cronSecret: () => process.env.CRON_SECRET,
  vapidPrivateKey: () => process.env.VAPID_PRIVATE_KEY,
  vapidSubject: () => process.env.VAPID_SUBJECT,
  whatsappToken: () => process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: () => process.env.WHATSAPP_PHONE_NUMBER_ID,
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY,
  enforceStaffMfa: () => process.env.ENFORCE_STAFF_MFA === "true",
} as const;

/** Public VAPID key for Web Push (safe to expose); absent = push awaiting configuration. */
export const vapidPublicKey = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
