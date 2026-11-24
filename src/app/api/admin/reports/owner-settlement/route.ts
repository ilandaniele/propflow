export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { SettlementQuerySchema } from '@/lib/schemas/owner-settlement';
import { ownerSettlements } from '@/lib/finance/owner-settlement-query';
import { ownerSettlementCsv } from '@/lib/finance/owner-settlement-csv';

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  if (!mutationRateLimit(ctx.userId, 'owner-settlement-export').success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429 });
  }

  const parsed = SettlementQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid month or owner.' } }, { status: 400 });
  }

  const { month, owner_id: ownerId } = parsed.data;
  const settlements = await ownerSettlements(ctx.orgId, { month, ownerId });

  return new NextResponse(ownerSettlementCsv(settlements), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="owner-settlement-${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
