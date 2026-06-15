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
 * - Admin client used only after session validation.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { createAdminClient } from '@/lib/supabase/admin';
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

  // 2. Require authenticated session
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'You must be signed in to accept an invitation.' } }, { status: 401 });
  }
  const user = { id: session.user.id, email: session.user.email ?? '' };

  const admin = createAdminClient();
  const tokenHash = sha256(parsed.data.token);

  // 3. Look up invitation
  const { data: invitation, error: inviteErr } = await admin
    .from('tenant_invitations')
    .select('id, org_id, tenant_id, email, status, expires_at')
    .eq('token_hash', tokenHash)
    .single();

  if (inviteErr || !invitation) {
    return NextResponse.json({ error: { code: 'INVALID_TOKEN', message: 'Invitation not found or already used.' } }, { status: 404 });
  }

  // Mark expired if past expiry
  if (invitation.status === 'pending' && new Date(invitation.expires_at) < new Date()) {
    await admin
      .from('tenant_invitations')
      .update({ status: 'expired' })
      .eq('id', invitation.id);
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
        message: `This invitation was sent to a different email address. Please sign in with the account that matches the invitation.`,
      },
    }, { status: 403 });
  }

  // 5. Create profile if none exists (role='tenant')
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single();

  if (!existingProfile) {
    const { error: profileErr } = await admin
      .from('profiles')
      .insert({
        id:     user.id,
        org_id: invitation.org_id,
        role:   'tenant',
      });
    if (profileErr) {
      log.error('[invite/accept] failed to create profile', { code: profileErr.code });
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to set up your account.' } }, { status: 500 });
    }
  }
  // If profile already exists in same org, just continue (link tenant below)

  // 6. Link tenant record to auth user
  const { error: linkErr } = await admin
    .from('tenants')
    .update({ profile_id: user.id, portal_access: 'active' })
    .eq('id', invitation.tenant_id)
    .eq('org_id', invitation.org_id);

  if (linkErr) {
    log.error('[invite/accept] failed to link tenant', { code: linkErr.code });
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to activate your portal access.' } }, { status: 500 });
  }

  // 7. Mark invitation accepted
  await admin
    .from('tenant_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  log.info('[invite/accept] accepted', { tenantId: invitation.tenant_id });
  return NextResponse.json({ accepted: true, redirectTo: '/portal' });
}
