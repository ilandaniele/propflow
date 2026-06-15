/**
 * POST /api/invite/accept
 *
 * Accepts a tenant invitation token. Requires an authenticated session.
 *
 * Flow:
 * 1. Hash the incoming token, look up the invitation.
 * 2. Reject if not pending or past expires_at (mark expired).
 * 3. Verify session user's email (normalized) matches invitation email → 403 if mismatch.
 * 4. Create profile row if none exists (role='tenant', org_id from invitation).
 * 5. Link: tenants.profile_id = user.id, portal_access='active'.
 * 6. Mark invitation accepted.
 *
 * CRITICAL: this links the auth user to the EXISTING tenant record.
 * Never creates a duplicate tenant row.
 *
 * Security:
 * - Token is hashed before DB lookup; raw token never hits the DB.
 * - Email comparison is normalized (trim + toLowerCase) on both sides.
 * - NextAuth auth() used for session — never trust client-supplied user ID.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { profiles, tenants, tenantInvitations } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { sha256 } from '@/lib/crypto/hash';

const BodySchema = z.object({
  token: z.string().min(1).max(512),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Parse + validate body
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body.' } }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'token is required.' } }, { status: 400 });
  }

  // 2. Require authenticated session via NextAuth
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'You must be signed in to accept an invitation.' } }, { status: 401 });
  }
  const userId    = session.user.id;
  const userEmail = session.user.email ?? '';

  const tokenHash = sha256(parsed.data.token);

  // 3. Look up invitation
  const invitation = await db.select({
    id:        tenantInvitations.id,
    orgId:     tenantInvitations.orgId,
    tenantId:  tenantInvitations.tenantId,
    email:     tenantInvitations.email,
    status:    tenantInvitations.status,
    expiresAt: tenantInvitations.expiresAt,
  })
    .from(tenantInvitations)
    .where(eq(tenantInvitations.tokenHash, tokenHash))
    .then(r => r[0] ?? null);

  if (!invitation) {
    return NextResponse.json({ error: { code: 'INVALID_TOKEN', message: 'Invitation not found or already used.' } }, { status: 404 });
  }

  // Mark expired if past expiry
  if (invitation.status === 'pending' && new Date(invitation.expiresAt) < new Date()) {
    await db.update(tenantInvitations)
      .set({ status: 'expired' })
      .where(eq(tenantInvitations.id, invitation.id));
    return NextResponse.json({ error: { code: 'TOKEN_EXPIRED', message: 'This invitation has expired. Ask your administrator to resend it.' } }, { status: 410 });
  }

  if (invitation.status !== 'pending') {
    const msg = invitation.status === 'accepted'
      ? 'This invitation has already been accepted.'
      : 'This invitation is no longer valid.';
    return NextResponse.json({ error: { code: 'INVITATION_NOT_PENDING', message: msg } }, { status: 409 });
  }

  // 4. Verify email match (normalized)
  const sessionEmail = userEmail.trim().toLowerCase();
  const inviteEmail  = invitation.email.trim().toLowerCase();

  if (sessionEmail !== inviteEmail) {
    log.warn('[invite/accept] email mismatch', { inviteDomain: inviteEmail.split('@')[1] });
    return NextResponse.json({
      error: {
        code: 'EMAIL_MISMATCH',
        message: 'This invitation was sent to a different email address. Please sign in with the account that matches the invitation.',
      },
    }, { status: 403 });
  }

  // 5. Create profile if none exists (role='tenant')
  const existingProfile = await db.select({ id: profiles.id, orgId: profiles.orgId, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .then(r => r[0] ?? null);

  if (!existingProfile) {
    try {
      await db.insert(profiles).values({
        userId,
        orgId: invitation.orgId,
        role:  'tenant',
      });
    } catch (err) {
      log.error('[invite/accept] failed to create profile', { code: err instanceof Error ? err.message : 'unknown' });
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to set up your account.' } }, { status: 500 });
    }
  }

  // Resolve profileId for tenants.profile_id FK (uses profiles.id, not users.id)
  const profileId = existingProfile?.id ?? (
    await db.select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .then(r => r[0]?.id ?? null)
  );

  if (!profileId) {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to set up your account.' } }, { status: 500 });
  }

  // 6. Link tenant record to auth user
  try {
    await db.update(tenants)
      .set({ profileId, portalAccess: 'active' })
      .where(and(eq(tenants.id, invitation.tenantId), eq(tenants.orgId, invitation.orgId)));
  } catch (err) {
    log.error('[invite/accept] failed to link tenant', { code: err instanceof Error ? err.message : 'unknown' });
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to activate your portal access.' } }, { status: 500 });
  }

  // 7. Mark invitation accepted
  await db.update(tenantInvitations)
    .set({ status: 'accepted', acceptedAt: new Date() })
    .where(eq(tenantInvitations.id, invitation.id));

  log.info('[invite/accept] accepted', { tenantId: invitation.tenantId });
  return NextResponse.json({ accepted: true, redirectTo: '/portal' });
}
