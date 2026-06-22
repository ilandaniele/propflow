/**
 * GET /api/invite/peek?token=<raw token>
 *
 * Public endpoint — no auth required. Returns masked context about a pending
 * invitation so the accept page can show the user which email address they must
 * sign in with.
 *
 * Returns ONLY: { maskedEmail, orgName } — never the raw email.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenantInvitations, organizations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { sha256 } from '@/lib/crypto/hash';

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

  const tokenHash = sha256(token);

  // Drizzle lookup — AC1
  const rows = await db
    .select({
      email:     tenantInvitations.email,
      status:    tenantInvitations.status,
      expiresAt: tenantInvitations.expiresAt,
      orgId:     tenantInvitations.orgId,
    })
    .from(tenantInvitations)
    .where(eq(tenantInvitations.tokenHash, tokenHash))
    .limit(1);

  const invitation = rows[0];

  if (!invitation) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Invitación no encontrada.' } }, { status: 404 });
  }

  if (invitation.status !== 'pending' || new Date(invitation.expiresAt) < new Date()) {
    return NextResponse.json({ error: { code: 'INVALID_TOKEN', message: 'Esta invitación ha vencido o ya no es válida.' } }, { status: 410 });
  }

  // Fetch org name — Drizzle (AC1, AC8: scoped to orgId from invitation row)
  const orgRows = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invitation.orgId))
    .limit(1);

  return NextResponse.json({
    maskedEmail: maskEmail(invitation.email),
    orgName: orgRows[0]?.name ?? 'PropFlow',
  });
}
