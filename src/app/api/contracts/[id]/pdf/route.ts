export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contracts, tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage/index';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';

const SIGNED_URL_TTL_SECONDS = 3600;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  // Load the contract — must belong to this org (AC8: orgId isolation) — Drizzle (AC1)
  const contractRows = await db
    .select({ id: contracts.id, orgId: contracts.orgId, documentUrl: contracts.documentUrl, tenantId: contracts.tenantId })
    .from(contracts)
    .where(and(eq(contracts.id, id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);

  const contract = contractRows[0];

  // IDOR: always 404, never 403 (no resource enumeration)
  if (!contract) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  if (!contract.documentUrl) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Tenant: must be the contract's own tenant — Drizzle (AC1)
  if (ctx.role === 'tenant') {
    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.id, contract.tenantId)))
      .limit(1);

    if (!tenantRows[0]) {
      return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
    }
  }

  // Generate signed URL via Tigris storage lib (AC1: no supabase.storage calls)
  try {
    const url = await getSignedUrl('contracts', contract.documentUrl, SIGNED_URL_TTL_SECONDS);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }
}
