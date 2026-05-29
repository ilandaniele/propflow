import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/types';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: 'admin' | 'tenant';
  profile: Profile;
}

/**
 * Verify the caller is authenticated. Returns AuthContext or throws.
 * Use in every Server Action and Route Handler.
 */
export async function requireUser(): Promise<AuthContext> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('UNAUTHORIZED');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('UNAUTHORIZED');
  }

  return {
    userId: user.id,
    orgId: profile.org_id,
    role: profile.role,
    profile,
  };
}

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
 * Returns org-scoped Supabase client for the authenticated user.
 * The client uses the anon key so RLS applies automatically.
 */
export async function getOrgScopedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return supabase;
}
