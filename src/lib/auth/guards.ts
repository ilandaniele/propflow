import { cache } from 'react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { Profile } from '@/types';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: 'admin' | 'tenant';
  profile: Profile;
}

/**
 * Returns the authenticated NextAuth session user for the current request.
 *
 * Wrapped in React.cache() so the session round-trip happens at most once
 * per React render pass regardless of how many Server Components call it.
 */
export const getCachedUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user as { id: string; email?: string | null; name?: string | null };
});

/**
 * Returns the authenticated user's profile row for the current request.
 *
 * Wrapped in React.cache() so the profiles SELECT is issued at most once per
 * render pass. Returns null if the user is not authenticated or has no profile row.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCachedUser();
  if (!user) return null;

  const rows = await db
    .select({
      id:       profiles.id,
      orgId:    profiles.orgId,
      role:     profiles.role,
      fullName: profiles.fullName,
      phone:    profiles.phone,
      email:    profiles.email,
    })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Map Drizzle camelCase to the Profile type shape (org_id, full_name)
  return {
    id:        row.id,
    org_id:    row.orgId,
    role:      row.role as 'admin' | 'tenant',
    full_name: row.fullName ?? undefined,
    phone:     row.phone ?? undefined,
    email:     row.email ?? undefined,
  } as unknown as Profile;
});

/**
 * Verify the caller is authenticated. Returns AuthContext or throws.
 * Use in every Server Action and Route Handler.
 */
export const requireUser = cache(async (): Promise<AuthContext> => {
  const user = await getCachedUser();
  if (!user) throw new Error('UNAUTHORIZED');

  const profile = await getProfile();
  if (!profile) throw new Error('UNAUTHORIZED');

  return {
    userId: user.id,
    orgId:  profile.org_id,
    role:   profile.role,
    profile,
  };
});

/**
 * Verify the caller is an admin. Returns AuthContext or throws.
 */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== 'admin') {
    throw new Error('FORBIDDEN');
  }
  return ctx;
}

/**
 * Verify the caller is a tenant. Returns AuthContext or throws.
 */
export async function requireTenant(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== 'tenant') {
    throw new Error('FORBIDDEN');
  }
  return ctx;
}

/**
 * Fast-path profile lookup for layouts — queries Drizzle directly.
 * Returns null when no row is found.
 */
export async function getProfileFast(userId: string): Promise<Profile | null> {
  const rows = await db
    .select({
      id:       profiles.id,
      orgId:    profiles.orgId,
      role:     profiles.role,
      fullName: profiles.fullName,
      phone:    profiles.phone,
      email:    profiles.email,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id:        row.id,
    org_id:    row.orgId,
    role:      row.role as 'admin' | 'tenant',
    full_name: row.fullName ?? undefined,
    phone:     row.phone ?? undefined,
    email:     row.email ?? undefined,
  } as unknown as Profile;
}

/**
 * Fast-path org name lookup for layouts — queries Drizzle directly.
 * Returns null when no row is found.
 */
export async function getOrgNameFast(orgId: string): Promise<string | null> {
  const { organizations } = await import('@/lib/db/schema');
  const rows = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return rows[0]?.name ?? null;
}
