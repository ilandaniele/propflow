export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { buildJournal, journalToCsv } from '@/lib/accounting/journal';
import { journalSource } from '@/lib/accounting/queries';
import { log } from '@/lib/log';

const QuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  if (!mutationRateLimit(ctx.userId, 'accounting-export').success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429 });
  }

  const parsed = QuerySchema.safeParse({ month: request.nextUrl.searchParams.get('month') });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'month must be YYYY-MM.' } }, { status: 400 });
  }

  try {
    const { month } = parsed.data;
    const source = await journalSource(ctx.orgId, month);
    const csv = journalToCsv(buildJournal(source.payments, source.expenses));
    log.adminAction(ctx.userId, 'accounting.export', 'journal', month);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="libro-diario-${month}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    log.error('[api/admin/accounting/export] exception', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Export failed.' } }, { status: 500 });
  }
}
