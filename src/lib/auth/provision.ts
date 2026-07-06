/**
 * Profile + Org provisioning — SERVER ONLY.
 * Uses Drizzle ORM against Fly Postgres.
 * Called during the NextAuth signIn callback when a user has no profile yet.
 */

import { randomBytes } from 'node:crypto';
import { and, asc, eq, ilike, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { organizations, profiles, tenants } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { isAllowlistedAdmin, getPrimaryOwnerEmail } from './admin-allowlist';

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
  // CSPRNG suffix — avoids predictable slug variants (no Math.random for identifiers).
  const suffix = randomBytes(3).toString('hex');
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
 * Resolve the "primary" organization that allowlisted admins should join:
 * the org of the primary owner (admin profile matched by email), falling back
 * to the oldest organization. Returns null only when no org exists at all.
 */
export async function resolvePrimaryOrgId(): Promise<string | null> {
  const ownerEmail = getPrimaryOwnerEmail();

  const ownerProfile = await db.query.profiles.findFirst({
    where: and(ilike(profiles.email, ownerEmail), eq(profiles.role, 'admin')),
    columns: { orgId: true },
  });
  if (ownerProfile?.orgId) return ownerProfile.orgId;

  // Fallback: the oldest org (single-tenant deployments, or owner not yet provisioned).
  const oldest = await db
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return oldest[0]?.id ?? null;
}

/**
 * Provision an allowlisted user as an ADMIN of the primary org (no new org).
 * Idempotent on profiles.user_id. If no primary org exists yet, falls back to
 * creating a fresh org (so the very first user still gets a workspace).
 */
export async function attachToPrimaryOrgAsAdmin(
  userId: string,
  email: string,
  fullName?: string | null,
): Promise<ProvisionResult> {
  const orgId = await resolvePrimaryOrgId();
  if (!orgId) {
    log.warn('[provision] no primary org found for allowlisted admin — creating new org', { userId });
    return provisionOrgAndProfile(userId, email, fullName ?? email, fullName ?? undefined);
  }

  const [inserted] = await db
    .insert(profiles)
    .values({ userId, orgId, role: 'admin', email, fullName: fullName ?? null })
    .onConflictDoNothing()
    .returning({ id: profiles.id });

  let profileId: string | undefined = inserted?.id;
  if (!profileId) {
    const existing = await db.query.profiles.findFirst({
      where: eq(profiles.userId, userId),
      columns: { id: true },
    });
    profileId = existing?.id;
  }

  if (!profileId) throw new Error('PROVISION_FAILED:primary_admin:no_rows');

  log.info('[provision] allowlisted admin attached to primary org', {
    event: 'provision_allowlist_admin', userId, orgId,
  });
  return { orgId, profileId, role: 'admin' };
}

/**
 * First-sign-in dispatcher: allowlisted emails become admins of the primary org;
 * everyone else gets a fresh org of their own (the default self-serve workspace).
 * `orgName` is only used for the non-allowlisted (new-workspace) path.
 */
export async function provisionUser(
  userId: string,
  email: string,
  fullName?: string | null,
  orgName?: string,
): Promise<ProvisionResult> {
  if (isAllowlistedAdmin(email)) {
    return attachToPrimaryOrgAsAdmin(userId, email, fullName);
  }
  return provisionOrgAndProfile(userId, email, orgName ?? fullName ?? email, fullName ?? undefined);
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
