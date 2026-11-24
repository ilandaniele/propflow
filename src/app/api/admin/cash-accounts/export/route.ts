export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { CashExportQuerySchema } from '@/lib/schemas/cash-account';
import { buildAnnualLiquidationCsv, buildMonthMovementsCsv } from '@/lib/finance/cash-export';

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const rl = mutationRateLimit(ctx.userId, 'cash-export');
  if (!rl.success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429 });
  }

  const parsed = CashExportQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'year, or account and month, are required.' } }, { status: 400 });
  }

  if ('year' in parsed.data) {
    const csv = await buildAnnualLiquidationCsv(ctx.orgId, parsed.data.year);
    return csvResponse(csv, `liquidacion-anual-${parsed.data.year}.csv`);
  }

  const csv = await buildMonthMovementsCsv(ctx.orgId, parsed.data.account, parsed.data.month);
  if (csv === null) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Account not found.' } }, { status: 404 });
  return csvResponse(csv, `caja-${parsed.data.month}.csv`);
}
