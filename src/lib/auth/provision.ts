/**
 * Profile + Org provisioning — SERVER ONLY.
 * Uses the service-role admin client which bypasses RLS.
 * Called ONLY when a Supabase auth user has no profile row yet.
 *
 * Security notes:
 * - assertServerEnv() fails fast if SUPABASE_SERVICE_ROLE_KEY is missing (IC4/LOW#12).
 * - The admin client is never exposed to the client bundle.
 * - Rollback: if the profile insert fails after the org is created, the org is deleted.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { assertServerEnv } from '@/lib/env';
import { log } from '@/lib/log';

export interface ProvisionResult {
  orgId: string;
  profileId: string;
  role: 'admin';
}

/**
 * Generate a URL-safe slug from an org name.
 * Lowercase, replace non-alphanumeric with hyphens, collapse repeated hyphens,
 * trim leading/trailing hyphens. Max 80 chars.
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
 * Tries the base slug first; appends a 6-char hex suffix on conflict.
 */
export function generateUniqueSlug(orgName: string, existingSlugs: Set<string> = new Set()): string {
  const base = generateSlug(orgName);
  if (!existingSlugs.has(base)) return base;
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${base}-${suffix}`.slice(0, 80);
}

/**
 * Provision a new org + admin profile for a freshly-authenticated Google (or other OAuth) user.
 * Atomic: if the profile insert fails after the org insert, the org is deleted (rollback).
 *
 * @param userId  Supabase auth.users.id for the new user (from getUser().data.user.id)
 * @param email   User's email — used to derive slug and stored in profile
 * @param orgName Human-readable org name chosen by the user in onboarding
 * @param fullName User's display name from OAuth identity (optional)
 */
export async function provisionOrgAndProfile(
  userId: string,
  email: string,
  orgName: string,
  fullName?: string
): Promise<ProvisionResult> {
  // Fail fast on missing service-role key — never silently no-op (IC4/LOW#12)
  assertServerEnv('SUPABASE_SERVICE_ROLE_KEY', 'provisionOrgAndProfile');

  const adminClient = createAdminClient();
  const slug = generateSlug(orgName);

  // 1. Create the organization
  const { data: org, error: orgError } = await adminClient
    .from('organizations')
    .insert({ name: orgName, slug })
    .select('id, slug')
    .single();

  if (orgError || !org) {
    log.error('[provision] org insert failed', { code: orgError?.code, userId });
    throw new Error(`PROVISION_FAILED:org:${orgError?.code ?? 'unknown'}`);
  }

  // 2. Create the profile — rollback org on failure
  const { error: profileError } = await adminClient
    .from('profiles')
    .insert({
      id: userId,
      org_id: org.id,
      role: 'admin' as const,
      full_name: fullName ?? null,
      email,
    });

  if (profileError) {
    log.error('[provision] profile insert failed — rolling back org', {
      code: profileError.code,
      orgId: org.id,
      userId,
    });

    // Rollback: delete the org we just created
    const { error: rollbackError } = await adminClient
      .from('organizations')
      .delete()
      .eq('id', org.id);

    if (rollbackError) {
      log.error('[provision] rollback failed — orphaned org', {
        code: rollbackError.code,
        orgId: org.id,
      });
    }

    throw new Error(`PROVISION_FAILED:profile:${profileError.code ?? 'unknown'}`);
  }

  log.info('[provision] org+profile created', {
    event: 'provision_success',
    userId,
    orgId: org.id,
    slug: org.slug,
  });

  return { orgId: org.id, profileId: userId, role: 'admin' };
}

/**
 * Check whether a profile row already exists for the given user id.
 * Uses the admin client to bypass RLS (needed during callback before session is fully set up).
 */
export async function getExistingProfile(userId: string): Promise<{ orgId: string; role: string } | null> {
  assertServerEnv('SUPABASE_SERVICE_ROLE_KEY', 'getExistingProfile');

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from('profiles')
    .select('org_id, role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    log.error('[provision] getExistingProfile failed', { code: error.code, userId });
    return null;
  }

  return data ? { orgId: data.org_id, role: data.role } : null;
}
