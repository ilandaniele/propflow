/**
 * Profile + Org provisioning — SERVER ONLY.
 * Uses Drizzle ORM against Fly Postgres.
 * Called during the NextAuth signIn callback when a user has no profile yet.
 */

import { and, eq, ilike, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { organizations, profiles, tenants } from '@/lib/db/schema';
import { log } from '@/lib/log';

export interface ProvisionResult {
  orgId: string;
  profileId: string;
  role: 'admin';
}

export function generateSlug(orgName: string): string {
  return orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function generateUniqueSlug(orgName: string, existingSlugs: Set<string> = new Set()): string {
  const base = generateSlug(orgName);
  if (!existingSlugs.has(base)) return base;
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${base}-${suffix}`.slice(0, 80);
}

/**
 * Provision a new org + admin profile for a freshly-authenticated Google user.
 * Rolls back the org if profile insert fails.
 */
export async function provisionOrgAndProfile(
  userId: string,
  email: string,
  orgName: string,
  fullName?: string,
): Promise<ProvisionResult> {
  const slug = generateSlug(orgName);

  const [org] = await db
    .insert(organizations)
    .values({ name: orgName, slug })
    .returning({ id: organizations.id, slug: organizations.slug });

  if (!org) {
    log.error('[provision] org insert returned no rows', { userId });
    throw new Error('PROVISION_FAILED:org:no_rows');
  }

  try {
    const [profile] = await db
      .insert(profiles)
      .values({ userId, orgId: org.id, role: 'admin', email, fullName: fullName ?? null })
      .returning({ id: profiles.id });

    if (!profile) throw new Error('no_rows');

    log.info('[provision] org+profile created', { event: 'provision_success', userId, orgId: org.id });
    return { orgId: org.id, profileId: profile.id, role: 'admin' };
  } catch (err) {
    const code = err instanceof Error ? err.message : 'unknown';
    log.error('[provision] profile insert failed — rolling back org', { code, orgId: org.id, userId });
    await db.delete(organizations).where(eq(organizations.id, org.id)).catch((e) => {
      log.error('[provision] rollback failed', { code: e instanceof Error ? e.message : 'unknown', orgId: org.id });
    });
    throw new Error(`PROVISION_FAILED:profile:${code}`);
  }
}

/**
 * Check whether a profile row already exists for the given NextAuth user id.
 */
export async function getExistingProfile(userId: string): Promise<{ orgId: string; role: string } | null> {
  try {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.userId, userId),
      columns: { orgId: true, role: true },
    });
    return profile ? { orgId: profile.orgId, role: profile.role } : null;
  } catch (err) {
    log.error('[provision] getExistingProfile failed', { code: err instanceof Error ? err.message : 'unknown', userId });
    return null;
  }
}

export type AutoLinkResult =
  | { linked: true; orgId: string }
  | { linked: false; reason: 'no_match' | 'ambiguous_match' };

/**
 * Attempt to auto-link a newly authenticated user to an existing tenant row.
 * Matches on email (case-insensitive) where profile_id IS NULL.
 */
export async function attemptAutoLink(userId: string, email: string): Promise<AutoLinkResult> {
  try {
    const rows = await db
      .select({ id: tenants.id, orgId: tenants.orgId })
      .from(tenants)
      .where(and(ilike(tenants.email, email), isNull(tenants.profileId)));

    if (rows.length === 0) {
      log.info('[provision] attemptAutoLink: no unlinked tenant row', { event: 'auto_link_no_match', userId });
      return { linked: false, reason: 'no_match' };
    }
    if (rows.length > 1) {
      log.warn('[provision] attemptAutoLink: ambiguous email', { event: 'auto_link_ambiguous', userId, matchCount: rows.length });
      return { linked: false, reason: 'ambiguous_match' };
    }

    const tenant = rows[0];

    // Insert profile (role=tenant); ignore conflict from concurrent requests
    const inserted = await db
      .insert(profiles)
      .values({ userId, orgId: tenant.orgId, role: 'tenant', email })
      .onConflictDoNothing()
      .returning({ id: profiles.id });

    let profileId: string | undefined = inserted[0]?.id;
    if (!profileId) {
      // Profile already existed — fetch it
      const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { id: true } });
      profileId = existing?.id;
    }

    if (profileId) {
      await db.update(tenants).set({ profileId, updatedAt: new Date() }).where(eq(tenants.id, tenant.id));
      log.info('[provision] attemptAutoLink: tenant linked', { event: 'auto_link_success', userId, tenantId: tenant.id, orgId: tenant.orgId });
      return { linked: true, orgId: tenant.orgId };
    }

    log.error('[provision] attemptAutoLink: profileId missing after insert', { userId });
    return { linked: false, reason: 'no_match' };
  } catch (err) {
    log.error('[provision] attemptAutoLink failed', { code: err instanceof Error ? err.message : 'unknown', userId });
    return { linked: false, reason: 'no_match' };
  }
}
