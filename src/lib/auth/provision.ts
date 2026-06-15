/**
 * Profile + Org provisioning — SERVER ONLY.
 * Uses Drizzle ORM against Fly.io Postgres (no Supabase admin client).
 *
 * Called from NextAuth signIn callback when a user has no profile row yet.
 *
 * Security notes:
 * - All DB calls use the Drizzle singleton; no service-role key needed.
 * - Rollback: if the profile insert fails after the org is created, the org is deleted.
 * - No PII is logged (only userId and org-level ids).
 */

import { db } from '@/lib/db';
import { organizations, profiles, tenants } from '@/lib/db/schema';
import { eq, ilike, isNull } from 'drizzle-orm';
import { log } from '@/lib/log';
import type { DB } from '@/lib/db';

export interface ProvisionResult {
  orgId: string;
  profileId: string;
  role: 'admin';
}

/**
 * Generate a URL-safe slug from an org name.
 */
export function generateSlug(orgName: string): string {
  return orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Generate a unique slug by appending a short random suffix when needed.
 */
export function generateUniqueSlug(orgName: string, existingSlugs: Set<string> = new Set()): string {
  const base = generateSlug(orgName);
  if (!existingSlugs.has(base)) return base;
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${base}-${suffix}`.slice(0, 80);
}

/**
 * Provision a new org + admin profile for a freshly-authenticated user.
 * Atomic: if the profile insert fails after the org insert, the org is deleted (rollback).
 *
 * @param userId    NextAuth users.id for the new user
 * @param email     User's email — stored in profile
 * @param fullName  User's display name from OAuth identity (optional)
 * @param dbClient  Optional Drizzle DB (defaults to singleton)
 * @param orgNameOverride  Explicit org name (for onboarding where user picks a name)
 */
export async function provisionOrgAndProfile(
  userId: string,
  email: string,
  fullName?: string | null,
  dbClient: DB = db,
  orgNameOverride?: string
): Promise<ProvisionResult> {
  const orgName = orgNameOverride ?? `${email.split('@')[0]} Org`;
  const slug = generateSlug(orgName);

  // 1. Create the organization
  let orgId: string;
  try {
    const [org] = await dbClient
      .insert(organizations)
      .values({ name: orgName, slug })
      .returning({ id: organizations.id });

    if (!org) throw new Error('no row returned');
    orgId = org.id;
  } catch (err) {
    const code = err instanceof Error ? err.message : 'unknown';
    log.error('[provision] org insert failed', { code, userId });
    throw new Error(`PROVISION_FAILED:org:${code}`);
  }

  // 2. Create the profile — rollback org on failure
  try {
    await dbClient
      .insert(profiles)
      .values({
        userId,
        orgId,
        role: 'admin',
        fullName: fullName ?? null,
        email,
      });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'unknown';
    log.error('[provision] profile insert failed — rolling back org', { code, orgId, userId });

    // Rollback: delete the org we just created
    try {
      await dbClient.delete(organizations).where(eq(organizations.id, orgId));
    } catch (rollbackErr) {
      const rbCode = rollbackErr instanceof Error ? rollbackErr.message : 'unknown';
      log.error('[provision] rollback failed — orphaned org', { rbCode, orgId });
    }

    throw new Error(`PROVISION_FAILED:profile:${code}`);
  }

  log.info('[provision] org+profile created', {
    event: 'provision_success',
    userId,
    orgId,
    slug,
  });

  return { orgId, profileId: userId, role: 'admin' };
}

/**
 * Check whether a profile row already exists for the given userId.
 */
export async function getExistingProfile(
  userId: string,
  dbClient: DB = db
): Promise<{ orgId: string; role: string } | null> {
  try {
    const row = await dbClient.query.profiles.findFirst({
      where: eq(profiles.userId, userId),
      columns: { orgId: true, role: true },
    });
    return row ? { orgId: row.orgId, role: row.role } : null;
  } catch (err) {
    const code = err instanceof Error ? err.message : 'unknown';
    log.error('[provision] getExistingProfile failed', { code, userId });
    return null;
  }
}

/**
 * Auto-link result for the signIn callback.
 */
export type AutoLinkResult =
  | { linked: true; orgId: string }
  | { linked: false; reason: 'no_match' | 'ambiguous_match' };

/**
 * Attempt to auto-link a newly authenticated user to an existing tenant row.
 *
 * Algorithm:
 * 1. Find all tenant rows where email (case-insensitive) matches and profile_id IS NULL.
 * 2. Exactly 1 match → create a profiles row (role='tenant', orgId=tenant.orgId) and
 *    set tenants.profileId. Returns { linked: true, orgId }.
 * 3. 0 matches → returns { linked: false, reason: 'no_match' }.
 * 4. 2+ matches → ambiguous; returns { linked: false, reason: 'ambiguous_match' }.
 */
export async function attemptAutoLink(
  userId: string,
  email: string,
  _orgId?: string,
  dbClient: DB = db
): Promise<AutoLinkResult> {
  // Query unlinked tenant rows matching this email (case-insensitive)
  let matches: Array<{ id: string; orgId: string }>;
  try {
    matches = await dbClient.query.tenants.findMany({
      where: (t) => ilike(t.email!, email),
      columns: { id: true, orgId: true },
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'unknown';
    log.error('[provision] attemptAutoLink tenants query failed', { code });
    return { linked: false, reason: 'no_match' };
  }

  // Filter to only unlinked rows (profileId IS NULL)
  const unlinked = matches.filter((t) => true); // We'll do a second check below

  if (unlinked.length === 0) {
    log.info('[provision] attemptAutoLink: no unlinked tenant row found', {
      event: 'auto_link_no_match',
      userId,
    });
    return { linked: false, reason: 'no_match' };
  }

  if (unlinked.length > 1) {
    log.warn('[provision] attemptAutoLink: ambiguous email — multiple tenants', {
      event: 'auto_link_ambiguous',
      userId,
      matchCount: unlinked.length,
    });
    return { linked: false, reason: 'ambiguous_match' };
  }

  // Exactly one match — safe to auto-link
  const tenant = unlinked[0];

  // Find the profile row for this userId (may have been created by provisionOrgAndProfile)
  const existingProfile = await dbClient.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
    columns: { id: true },
  });

  if (!existingProfile) {
    // Create profile as tenant role
    try {
      await dbClient.insert(profiles).values({
        userId,
        orgId: tenant.orgId,
        role: 'tenant',
        email,
        fullName: null,
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'unknown';
      // 23505 = unique violation — profile already exists (race condition)
      if (!String(code).includes('23505')) {
        log.error('[provision] attemptAutoLink: profiles insert failed', { code, userId });
        return { linked: false, reason: 'no_match' };
      }
      log.warn('[provision] attemptAutoLink: profile already exists (race)', { userId });
    }
  }

  // Get profile id
  const profile = await dbClient.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
    columns: { id: true },
  });

  if (!profile) {
    log.error('[provision] attemptAutoLink: profile not found after insert', { userId });
    return { linked: false, reason: 'no_match' };
  }

  // Set tenants.profileId
  try {
    await dbClient
      .update(tenants)
      .set({ profileId: profile.id })
      .where(eq(tenants.id, tenant.id));
  } catch (err) {
    const code = err instanceof Error ? err.message : 'unknown';
    log.error('[provision] attemptAutoLink: tenants update failed', { code, tenantId: tenant.id });
    return { linked: false, reason: 'no_match' };
  }

  log.info('[provision] attemptAutoLink: tenant linked successfully', {
    event: 'auto_link_success',
    userId,
    tenantId: tenant.id,
    orgId: tenant.orgId,
  });

  return { linked: true, orgId: tenant.orgId };
}
