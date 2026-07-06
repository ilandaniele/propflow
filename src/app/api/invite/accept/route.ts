/**
 * POST /api/invite/accept
 *
 * Accepts a tenant invitation token. Requires an authenticated session.
 *
 * Security:
 * - Token is hashed before DB lookup; raw token never hits the DB.
 * - Email comparison is normalized (trim + toLowerCase) on both sides.
 * - User identity from session (NextAuth), never from request body.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { tenantInvitations, profiles, tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
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

  // 2. Require authenticated session (NextAuth — never trust client user IDs)
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'You must be signed in to accept an invitation.' } }, { status: 401 });
  }

  const tokenHash = sha256(parsed.data.token);

  // 3. Look up invitation — Drizzle (AC1)
  const invitations = await db
    .select({
      id:        tenantInvitations.id,
      orgId:     tenantInvitations.orgId,
      tenantId:  tenantInvitations.tenantId,
      email:     tenantInvitations.email,
      status:    tenantInvitations.status,
      expiresAt: tenantInvitations.expiresAt,
    })
    .from(tenantInvitations)
    .where(eq(tenantInvitations.tokenHash, tokenHash))
    .limit(1);

  const invitation = invitations[0];

  if (!invitation) {
    return NextResponse.json({ error: { code: 'INVALID_TOKEN', message: 'Invitation not found or already used.' } }, { status: 404 });
  }

  // Mark expired if past expiry
  if (invitation.status === 'pending' && new Date(invitation.expiresAt) < new Date()) {
    await db
      .update(tenantInvitations)
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
  const sessionEmail = (user.email ?? '').trim().toLowerCase();
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

  // 5. Create profile if none exists (role='tenant') — Drizzle (AC1)
  const existingProfiles = await db
    .select({ id: profiles.id, orgId: profiles.orgId, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const existingProfile = existingProfiles[0];

  // Isolation guard: profiles.userId is UNIQUE (one org per user). If the caller
  // already belongs to a DIFFERENT org, refuse — silently linking the tenant here
  // would attach an org's tenant record to a user whose profile lives in another
  // org, creating an ambiguous cross-org state. Fail closed.
  if (existingProfile && existingProfile.orgId !== invitation.orgId) {
    log.warn('[invite/accept] user already belongs to a different org');
    return NextResponse.json({
      error: {
        code: 'ALREADY_IN_ORG',
        message: 'This account is already associated with another organization. Use a different email to accept this invitation.',
      },
    }, { status: 409 });
  }

  if (!existingProfile) {
    try {
      await db.insert(profiles).values({
        userId: user.id,
        orgId:  invitation.orgId,
        role:   'tenant',
      });
    } catch (err) {
      log.error('[invite/accept] failed to create profile', { error: err instanceof Error ? err.message : 'unknown' });
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to set up your account.' } }, { status: 500 });
    }
  }
  // If profile already exists in the SAME org, just continue (link tenant below)

  // 6. Link tenant record to auth user — Drizzle (AC1, AC8: org_id scoped)
  const updated = await db
    .update(tenants)
    .set({ profileId: user.id, portalAccess: 'active' })
    .where(and(eq(tenants.id, invitation.tenantId), eq(tenants.orgId, invitation.orgId)))
    .returning({ id: tenants.id });

  if (updated.length === 0) {
    log.error('[invite/accept] failed to link tenant', { tenantId: invitation.tenantId });
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to activate your portal access.' } }, { status: 500 });
  }

  // 7. Mark invitation accepted — Drizzle
  await db
    .update(tenantInvitations)
    .set({ status: 'accepted', acceptedAt: new Date() })
    .where(eq(tenantInvitations.id, invitation.id));

  log.info('[invite/accept] accepted', { tenantId: invitation.tenantId });
  return NextResponse.json({ accepted: true, redirectTo: '/portal' });
}
