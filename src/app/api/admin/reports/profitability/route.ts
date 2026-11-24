export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { ProfitabilityQuerySchema } from '@/lib/schemas/profitability';
import { profitabilityReport } from '@/lib/finance/profitability-query';
import { profitabilityCsv } from '@/lib/finance/profitability-csv';

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  if (!mutationRateLimit(ctx.userId, 'profitability-export').success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429 });
  }

  const parsed = ProfitabilityQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid year or property.' } }, { status: 400 });
  }

  const { year, property_id: propertyId } = parsed.data;
  const report = await profitabilityReport(ctx.orgId, { year, propertyId });

  return new NextResponse(profitabilityCsv(report), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="profitability-${year}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
