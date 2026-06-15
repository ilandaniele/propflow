'use server';

/**
 * Onboarding Server Action — createOrg
 *
 * Called by the /onboarding page when a new Google (or future OAuth) user
 * creates their first organization.
 *
 * Security contract (IC3/IC4):
 * - Uses NextAuth auth() directly — new users have no profile yet, so requireUser()
 *   would throw UNAUTHORIZED. Instead, we verify the session via auth() directly.
 * - Idempotency: if a profile already exists, short-circuit and redirect to role home.
 * - Rate limit: 5 req / 10s per IP (authRateLimit key with 'onboarding:' prefix).
 * - Zod validation: orgName min(2) max(120), trimmed.
 * - NEVER accepts userId from FormData — always derived from server-side session.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/auth';
import { provisionOrgAndProfile, getExistingProfile } from '@/lib/auth/provision';
import { checkRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { AuthState } from '@/app/actions/auth';
export type { AuthState };

const CreateOrgSchema = z.object({
  orgName:       z.string().trim().min(2, 'Org name must be at least 2 characters').max(120, 'Org name must be at most 120 characters'),
  termsAccepted: z.coerce.boolean().optional(),
});

export async function createOrg(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // 1. Rate limit by IP
  const headersList = await headers();
  const forwardedFor = headersList.get('x-forwarded-for') ?? 'anonymous';
  const ip = forwardedFor.split(',')[0].trim();

  const rl = checkRateLimit(`onboarding:${ip}`, 5, 10_000);
  if (!rl.success) {
    log.warn('[onboarding] rate limited', { ip });
    return { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait before trying again.' } };
  }

  // 2. Verify session — use NextAuth auth() directly (no profile yet for new users)
  const session = await auth();

  if (!session?.user?.id) {
    return { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } };
  }

  const userId = session.user.id;
  const userEmail = session.user.email ?? '';
  const userName = session.user.name ?? undefined;

  // 3. Idempotency: if a profile already exists, skip provisioning and route to role home
  const existingProfile = await getExistingProfile(userId);
  if (existingProfile) {
    log.info('[onboarding] profile already exists — skipping provisioning', {
      userId,
      role: existingProfile.role,
    });
    // redirect() throws internally — do NOT wrap in try/catch
    redirect(existingProfile.role === 'admin' ? '/dashboard' : '/portal');
  }

  // 4. Validate input
  const parsed = CreateOrgSchema.safeParse({
    orgName:       formData.get('orgName'),
    termsAccepted: formData.get('termsAccepted'),
  });

  if (!parsed.success) {
    return { error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Validation failed' } };
  }

  // 5. Provision org + profile (atomic with rollback — see src/lib/auth/provision.ts)
  try {
    const result = await provisionOrgAndProfile(
      userId,
      userEmail,
      typeof userName === 'string' ? userName : undefined,
      undefined,
      parsed.data.orgName
    );

    // Store terms acceptance if user accepted during onboarding
    if (parsed.data.termsAccepted && result?.profileId) {
      const { db } = await import('@/lib/db');
      const { profiles } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const now = new Date();
      await db.update(profiles).set({
        termsAcceptedAt:   now,
        termsVersion:      '1.0',
        privacyAcceptedAt: now,
        privacyVersion:    '1.0',
      }).where(eq(profiles.id, result.profileId));
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.name : 'unknown';
    log.error('[onboarding] provisioning failed', { errMsg, userId });
    return { error: { code: 'PROVISION_FAILED', message: 'Failed to set up your workspace. Please try again.' } };
  }

  // 6. Success — redirect to dashboard
  // redirect() throws internally — do NOT wrap in try/catch
  redirect('/dashboard');
}
