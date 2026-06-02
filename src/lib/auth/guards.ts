import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/types';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: 'admin' | 'tenant';
  profile: Profile;
}

/**
 * Returns the authenticated Supabase user for the current request.
 *
 * Wrapped in React.cache() so the JWT validation round-trip to Supabase Auth
 * happens at most once per React render pass regardless of how many Server
 * Components call it.
 *
 * NEVER use getSession() here — getUser() validates the JWT against the
 * Supabase Auth server, while getSession() only reads from the cookie without
 * server-side revalidation.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

/**
 * Returns the authenticated user's profile row for the current request.
 *
 * Wrapped in React.cache() so the profiles SELECT is issued at most once per
 * render pass regardless of how many callers (layout, page, requireAdmin, etc.)
 * invoke it. SELECT is narrowed to only the columns used by the application.
 *
 * Returns null if the user is not authenticated or has no profile row.
 */
export const getProfile = cache(async () => {
  const user = await getCachedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, org_id, role, full_name, phone, email')
    .eq('id', user.id)
    .single();

  if (error || !profile) return null;
  // Cast: the narrowed select shape is assignment-compatible with Profile
  // (all returned columns are present in the Profile Row type).
  return profile as Profile;
});

/**
 * Verify the caller is authenticated. Returns AuthContext or throws.
 * Use in every Server Action and Route Handler.
 *
 * Wrapped in React.cache() so the combined getUser + getProfile round-trips
 * are deduplicated across layout + page + guards within one render pass.
 */
export const requireUser = cache(async (): Promise<AuthContext> => {
  const user = await getCachedUser();
  if (!user) throw new Error('UNAUTHORIZED');

  const profile = await getProfile();
  if (!profile) throw new Error('UNAUTHORIZED');

  return {
    userId: user.id,
    orgId: profile.org_id,
    role: profile.role,
    profile,
  };
});

/**
 * Verify the caller is an admin. Returns AuthContext or throws.
 *
 * Calls the cached requireUser() — no additional round-trips beyond what
 * requireUser() already performs (which are themselves deduplicated per request).
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
 *
 * Calls the cached requireUser() — no additional round-trips beyond what
 * requireUser() already performs (which are themselves deduplicated per request).
 */
export async function requireTenant(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.role !== 'tenant') {
    throw new Error('FORBIDDEN');
  }
  return ctx;
}

/**
 * Returns org-scoped Supabase client for the authenticated user.
 * The client uses the anon key so RLS applies automatically.
 */
export async function getOrgScopedClient() {
  const user = await getCachedUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return createClient();
}
