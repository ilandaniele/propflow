/**
 * Airtable <-> organization binding.
 *
 * The Airtable integration uses ONE global PAT/base (env vars) that holds a
 * single owner's real tenant PII, contracts and payments. It must therefore be
 * bound to exactly one organization — never copied into, or writable from,
 * any other org (registration is open, so any user can own a fresh org).
 *
 * Bound org = AIRTABLE_ORG_ID when set, else the primary owner's org
 * (resolvePrimaryOrgId — same resolution used for the admin allowlist).
 */

import { resolvePrimaryOrgId } from '@/lib/auth/provision';

/** Returns the org id the Airtable integration is bound to, or null if none exists. */
export async function getAirtableOrgId(): Promise<string | null> {
  const explicit = process.env.AIRTABLE_ORG_ID?.trim();
  if (explicit) return explicit;
  return resolvePrimaryOrgId();
}

/** True only when `orgId` is the single org bound to the Airtable integration. */
export async function isAirtableOrg(orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const bound = await getAirtableOrgId();
  return bound !== null && bound === orgId;
}

/** Shared 403 body for admin routes called by an org that is not the bound org. */
export const AIRTABLE_NOT_ENABLED_ERROR = {
  error: {
    code: 'AIRTABLE_NOT_ENABLED',
    message: 'Airtable integration is not enabled for this organization.',
  },
} as const;
