/**
 * Admin allowlist — SERVER ONLY.
 *
 * Emails listed here are provisioned as ADMIN of the PRIMARY organization the
 * first time they sign in (Google OAuth or email/password sign-up), instead of
 * getting a fresh empty org of their own. This is how co-admins are added to an
 * existing workspace without a manual DB write.
 *
 * Why an allowlist and not a direct DB insert: a profile row requires a `users`
 * row (FK), which only exists after the person authenticates. Pre-creating a
 * `users` row for a Google email would also break OAuth (NextAuth raises
 * OAuthAccountNotLinked when an unlinked user with that email already exists).
 * Pre-authorising by email sidesteps both problems.
 *
 * The static list can be extended at runtime via the ADMIN_ALLOWLIST env var
 * (comma-separated emails). PRIMARY_OWNER_EMAIL controls whose org allowlisted
 * admins join (defaults to the project owner).
 */

// Co-admins to attach to the primary org on first sign-in.
const STATIC_ADMIN_ALLOWLIST = [
  'kbenites@studenthub.host',
  'kiefbenites@gmail.com',
];

const DEFAULT_PRIMARY_OWNER_EMAIL = 'ilan.daniele@gmail.com';

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Full set of allowlisted admin emails (static list + ADMIN_ALLOWLIST env). */
export function getAdminAllowlist(): Set<string> {
  const fromEnv = (process.env.ADMIN_ALLOWLIST ?? '')
    .split(',')
    .map(normalize)
    .filter(Boolean);
  return new Set([...STATIC_ADMIN_ALLOWLIST.map(normalize), ...fromEnv]);
}

/** True when the given email should be provisioned as a primary-org admin. */
export function isAllowlistedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminAllowlist().has(normalize(email));
}

/** Email of the owner whose organization allowlisted admins join. */
export function getPrimaryOwnerEmail(): string {
  return normalize(process.env.PRIMARY_OWNER_EMAIL ?? DEFAULT_PRIMARY_OWNER_EMAIL);
}
