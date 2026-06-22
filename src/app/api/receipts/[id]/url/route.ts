export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { receiptUploads } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage/index';
import { Errors } from '@/lib/errors';

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  // Load the receipt — must belong to this org (AC8: org_id isolation) — Drizzle (AC1)
  const rows = await db
    .select({ id: receiptUploads.id, filePath: receiptUploads.filePath, uploadedBy: receiptUploads.uploadedBy })
    .from(receiptUploads)
    .where(and(eq(receiptUploads.id, id), eq(receiptUploads.orgId, ctx.orgId)))
    .limit(1);

  const receipt = rows[0];
  if (!receipt) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Tenant can only access their own receipts (defense in depth)
  if (ctx.role === 'tenant' && receipt.uploadedBy !== ctx.userId) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Generate signed URL via Tigris storage lib (AC3: no direct supabase.storage calls)
  try {
    const url = await getSignedUrl('receipts', receipt.filePath, SIGNED_URL_TTL_SECONDS);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }
}
