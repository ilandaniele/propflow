import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrizzleProfile = InferSelectModel<typeof profiles>;

export interface AuthContext {
  userId: string;
  orgId: string;
  role: 'admin' | 'tenant';
  profile: DrizzleProfile;
}

// ---------------------------------------------------------------------------
// Core guards — used in Server Actions and Route Handlers
// No supabase.auth calls — identity comes from NextAuth session (AC8, AC11)
// ---------------------------------------------------------------------------

/**
 * Verify the caller is an authenticated admin.
 * Returns AuthContext or throws 'unauthorized' / 'profile_not_found'.
 *
 * AC8: returns {userId, orgId, role:'admin', profile}; no supabase.auth calls;
 *      profile fetched via Drizzle.
 */
export async function requireAdmin(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    throw new Error('unauthorized');
  }
  if (!session.user.orgId) throw new Error('unauthorized');
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, session.user.id),
  });
  if (!profile) throw new Error('profile_not_found');
  return {
    userId: session.user.id,
    orgId: session.user.orgId,
    role: 'admin' as const,
    profile,
  };
}

/**
 * Verify the caller is an authenticated tenant.
 * Redirects to /dashboard if the session belongs to an admin.
 * Returns AuthContext or throws 'unauthorized' / 'profile_not_found'.
 *
 * AC9: rejects admin session (redirect /dashboard).
 */
export async function requireTenant(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');
  if (!session.user.orgId) throw new Error('unauthorized');
  // Admin trying to use a tenant-only action → redirect to admin area (AC9)
  if (session.user.role === 'admin') {
    redirect('/dashboard');
  }
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, session.user.id),
  });
  if (!profile) throw new Error('profile_not_found');
  return {
    userId: session.user.id,
    orgId: session.user.orgId,
    role: 'tenant' as const,
    profile,
  };
}

/**
 * Verify the caller is authenticated (any role).
 * Returns AuthContext or throws 'unauthorized' / 'profile_not_found'.
 *
 * Used in Server Actions that are available to both admins and tenants.
 */
export const requireUser = cache(async (): Promise<AuthContext> => {
  const session = await auth();
  if (!session?.user) throw new Error('UNAUTHORIZED');

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, session.user.id),
  });
  if (!profile) throw new Error('UNAUTHORIZED');

  const role = session.user.role;
  if (role !== 'admin' && role !== 'tenant') throw new Error('UNAUTHORIZED');

  return {
    userId: session.user.id,
    orgId: session.user.orgId,
    role,
    profile,
  };
});

// ---------------------------------------------------------------------------
// Fast-path helpers — for use in layouts only
//
// Backed by unstable_cache (cross-request server-side cache) so they survive
// across navigations, not only within one render pass like React.cache().
//
// The TTL is acceptable for layout cosmetics (display name, org name) but NOT
// for authorization decisions — pages must still call requireAdmin()/requireTenant()
// which trigger a fresh auth() round-trip (defense in depth).
// ---------------------------------------------------------------------------

/**
 * Returns the profile row for a given userId, cached for 60 seconds.
 * Cache is tagged 'profile-{userId}' for targeted invalidation.
 *
 * Returns null when no row is found.
 * SAFE TO USE IN LAYOUTS: userId originates from the NextAuth session.
 */
export function getProfileFast(userId: string): Promise<DrizzleProfile | null> {
  return unstable_cache(
    async (uid: string) => {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.userId, uid),
      });
      return profile ?? null;
    },
    ['profile', userId],
    {
      revalidate: 60,
      tags: [`profile-${userId}`],
    }
  )(userId);
}

/**
 * Returns the organization name for a given orgId, cached for 300 seconds.
 * Cache is tagged 'org-{orgId}' for targeted invalidation.
 *
 * Returns null when no row is found.
 * SAFE TO USE IN LAYOUTS: orgId comes from the session-validated profile.
 */
export function getOrgNameFast(orgId: string): Promise<string | null> {
  return unstable_cache(
    async (oid: string) => {
      const { organizations } = await import('@/lib/db/schema');
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, oid),
        columns: { name: true },
      });
      return org?.name ?? null;
    },
    ['org', orgId],
    {
      revalidate: 300,
      tags: [`org-${orgId}`],
    }
  )(orgId);
}
