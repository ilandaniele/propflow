/**
 * POST /api/admin/tenants/[tenantId]/invite
 *
 * Generates a secure one-time invitation token for a tenant, revokes any prior
 * pending invitation, sets portal_access='invited', and optionally sends an email
 * via Resend. If RESEND_API_KEY is not configured, the invite URL is still returned
 * in the response so the admin can copy and share it manually.
 *
 * Security:
 * - requireAdmin: caller must be an admin in the same org as the tenant.
 * - Only sha256 of the raw token is stored; raw token is single-use and never persisted.
 * - expires_at = 7 days from now.
 */

export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, tenantInvitations, organizations } from '@/lib/db/schema';
import { sendEmail } from '@/lib/notifications/email';
import { log } from '@/lib/log';
import { sha256 } from '@/lib/crypto/hash';

const INVITE_TTL_DAYS = 7;

function buildInviteEmail(opts: {
  inviteUrl: string;
  expiresAt: Date;
  orgName: string;
}): { subject: string; html: string } {
  const expiryStr = opts.expiresAt.toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });
  const safeUrl = opts.inviteUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const safeOrg = opts.orgName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return {
    subject: `Invitación al portal de inquilinos — ${opts.orgName}`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="font-size:20px;margin-bottom:8px">Bienvenido al portal de inquilinos</h1>
  <p>Has sido invitado a acceder al portal de inquilinos de <strong>${safeOrg}</strong>.</p>
  <p>Haz clic en el siguiente enlace para crear tu cuenta o iniciar sesión:</p>
  <p style="margin:24px 0">
    <a href="${safeUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      Acceder al portal
    </a>
  </p>
  <p style="color:#64748b;font-size:14px">
    Si el botón no funciona, copia este enlace en tu navegador:<br>
    ${safeUrl}
  </p>
  <p style="color:#64748b;font-size:12px;margin-top:32px">
    Este enlace vence el ${expiryStr} y solo puede usarse una vez.
    Si no esperabas este correo, puedes ignorarlo con seguridad.
  </p>
</body>
</html>`,
  };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { tenantId } = await params;

  // Verify tenant belongs to admin's org and has an email
  const tenant = await db.select({
    id:      tenants.id,
    orgId:   tenants.orgId,
    email:   tenants.email,
    fullName: tenants.fullName,
  })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!tenant) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, { status: 404 });
  }

  if (!tenant.email) {
    return NextResponse.json({ error: { code: 'NO_EMAIL', message: 'Tenant has no email address. Add one before sending an invitation.' } }, { status: 422 });
  }

  // Revoke any prior pending invitations for this tenant
  await db.update(tenantInvitations)
    .set({ status: 'revoked' })
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.status, 'pending')));

  // Generate token — 32 random bytes (256 bits); only hash stored
  const rawToken  = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    await db.insert(tenantInvitations).values({
      orgId:     ctx.orgId,
      tenantId,
      email:     tenant.email.trim().toLowerCase(),
      tokenHash,
      invitedBy: ctx.userId,
      status:    'pending',
      expiresAt,
    });
  } catch (err) {
    log.error('[invite] failed to insert invitation', { code: err instanceof Error ? err.message : 'unknown' });
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create invitation.' } }, { status: 500 });
  }

  // Set portal_access='invited'
  await db.update(tenants).set({ portalAccess: 'invited' }).where(eq(tenants.id, tenantId));

  const siteUrl  = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000';
  const inviteUrl = `${siteUrl}/invite/accept?token=${rawToken}`;

  // Attempt email — soft-skip if Resend not configured
  let emailSent = false;
  const resendKey = process.env['RESEND_API_KEY'];
  if (resendKey) {
    // Get org name for email
    const org = await db.select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .then(r => r[0] ?? null);

    const { subject, html } = buildInviteEmail({ inviteUrl, expiresAt, orgName: org?.name ?? 'PropFlow' });
    const result = await sendEmail({
      to: tenant.email,
      subject,
      html,
      context: 'tenant_invitation',
    });
    emailSent = result.success;
    if (!result.success) {
      log.warn('[invite] email failed — returning URL for manual copy', { error: result.error });
    }
  } else {
    log.info('[invite] RESEND_API_KEY not configured — returning invite URL only');
  }

  return NextResponse.json({
    invited:   true,
    inviteUrl,
    emailSent,
    expiresAt: expiresAt.toISOString(),
  });
}
