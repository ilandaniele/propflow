/**
 * GET /api/invite/peek?token=<raw token>
 *
 * Public endpoint — no auth required. Returns masked context about a pending
 * invitation so the accept page can show the user which email address they must
 * sign in with.
 *
 * Returns ONLY: { maskedEmail, orgName } — never the raw email.
 * If the invitation is not found / expired / not pending → 404 (same shape as above,
 * with error.message set). No enumeration risk because the token is 256-bit random.
 */

export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local && local.length > 2 ? local.slice(0, 2) : local?.slice(0, 1) ?? '';
  return `${visible}***@${domain}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  if (!token || token.length > 512) {
    return NextResponse.json({ error: { code: 'INVALID_TOKEN', message: 'Token inválido.' } }, { status: 400 });
  }

  const admin = createAdminClient();
  const tokenHash = sha256(token);

  const { data: invitation } = await admin
    .from('tenant_invitations')
    .select('email, status, expires_at, org_id')
    .eq('token_hash', tokenHash)
    .single();

  if (!invitation) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Invitación no encontrada.' } }, { status: 404 });
  }

  if (invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
    const msg = invitation.status === 'accepted'
      ? 'Esta invitación ya fue aceptada.'
      : 'Esta invitación ha vencido o ya no es válida.';
    return NextResponse.json({ error: { code: 'INVALID_TOKEN', message: msg } }, { status: 410 });
  }

  // Fetch org name
  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', invitation.org_id)
    .single();

  return NextResponse.json({
    maskedEmail: maskEmail(invitation.email),
    orgName: org?.name ?? 'PropFlow',
  });
}
