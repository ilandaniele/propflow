/**
 * Environment variable access — all values are lazy (accessed via getter at request time,
 * not at module import time). This prevents Next.js static-analysis / build-time module
 * evaluation from throwing when env vars are absent from the build container.
 *
 * NEXT_PUBLIC_* vars: available in the browser bundle AND on the server at request time.
 *   They are injected at compile time (build-time env or local .env). Lazy getters prevent
 *   build-time throws when static-analysis runs before the runtime context is set up.
 *
 * Server-only vars (ANTHROPIC_API_KEY, RESEND_*, CRON_SECRET):
 *   Only available at request time — NEVER in the build container. Always lazy.
 */

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

// ---------------------------------------------------------------------------
// Public env — safe to import in both Server and Client components.
// NEXT_PUBLIC_* values are inlined by the compiler into the browser bundle, so
// they must still be set in the build environment (CI or local .env).
// ---------------------------------------------------------------------------
export const env = {
  get NEXT_PUBLIC_SITE_URL() { return optional('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000'); },
};

// ---------------------------------------------------------------------------
// Server-only env — NEVER import in 'use client' modules.
// IC-C4: use assertServerEnv() at the call-site to get a clear error message.
// ---------------------------------------------------------------------------
export const serverEnv = {
  // Observability
  get SENTRY_DSN() { return optional('SENTRY_DSN'); },
  get CSP_REPORT_URI() { return optional('CSP_REPORT_URI'); },
  // Phase 2 keys — server-only, never NEXT_PUBLIC_*
  get ANTHROPIC_API_KEY() { return optional('ANTHROPIC_API_KEY'); },
  get RESEND_API_KEY() { return optional('RESEND_API_KEY'); },
  get RESEND_FROM_EMAIL() { return optional('RESEND_FROM_EMAIL'); },
  get CRON_SECRET() { return optional('CRON_SECRET'); },
  // Phase 4: WhatsApp webhook signature validation
  get WHATSAPP_WEBHOOK_SECRET() { return optional('WHATSAPP_WEBHOOK_SECRET'); },
  // Agent: AES-256-GCM key for encrypting secrets at rest (e.g. Google Calendar refresh tokens)
  get TOKEN_ENCRYPTION_KEY() { return optional('TOKEN_ENCRYPTION_KEY'); },
  // E-invoicing: Nubefact route URL + token; sandbox provider when either is empty
  get NUBEFACT_API_URL() { return optional('NUBEFACT_API_URL'); },
  get NUBEFACT_API_TOKEN() { return optional('NUBEFACT_API_TOKEN'); },
};

/**
 * Assert a server-only key is present at point of use (IC-C4 fail-fast pattern).
 * Throws with a clear message instead of silently returning an empty string.
 */
export function assertServerEnv(key: keyof typeof serverEnv, featureName: string): string {
  const value = serverEnv[key];
  if (!value) {
    throw new Error(
      `[env] ${key} is required for ${featureName} but is not set. ` +
      `Add it to .env.local (dev) or wrangler secrets (prod).`
    );
  }
  return value;
}
