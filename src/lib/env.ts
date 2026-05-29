import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional().default('http://localhost:3000'),
});

// Parse at module load — fails loudly at startup if required vars are missing
export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

// Server-only env — NEVER import in 'use client' modules
// IC-C4: SUPABASE_SERVICE_ROLE_KEY hardened with runtime assertion at use-site (see createAdminClient)
export const serverEnv = {
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL ?? '',
  SENTRY_DSN: process.env.SENTRY_DSN ?? '',
  CSP_REPORT_URI: process.env.CSP_REPORT_URI ?? '',
  // Phase 2 keys — server-only, never NEXT_PUBLIC_*
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? '',
  CRON_SECRET: process.env.CRON_SECRET ?? '',
};

/**
 * Assert a server-only key is present at point of use (IC-C4 fail-fast pattern).
 * Throws with a clear message instead of silently using an empty string.
 */
export function assertServerEnv(key: keyof typeof serverEnv, featureName: string): string {
  const value = serverEnv[key];
  if (!value) {
    throw new Error(
      `[env] ${key} is required for ${featureName} but is not set. ` +
      `Add it to .env.local (dev) or Vercel environment variables (staging/prod).`
    );
  }
  return value;
}
