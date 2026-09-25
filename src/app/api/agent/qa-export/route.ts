/**
 * GET /api/agent/qa-export?id=<uuid>
 * GET /api/agent/qa-export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Downloads a QA export CSV — either a previously generated weekly row
 * (`id`, org-scoped, cached csv column) or an ad-hoc range (`from`/`to`,
 * generated on the fly, never persisted). See src/lib/agent/qa-export.ts.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { db } from '@/lib/db';
import { qaExports } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { collectQaRows, toCsv } from '@/lib/agent/qa-export';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { log } from '@/lib/log';

const MAX_RANGE_DAYS = 31;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const QuerySchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ from: z.string().regex(DATE_RE), to: z.string().regex(DATE_RE) }),
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const rl = mutationRateLimit(ctx.userId, 'qa-export');
  if (!rl.success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429 });
  }

  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams);
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'id, or from and to, are required.' } }, { status: 400 });
  }

  if ('id' in parsed.data) {
    const rows = await db
      .select({ csv: qaExports.csv, weekStart: qaExports.weekStart })
      .from(qaExports)
      .where(and(eq(qaExports.id, parsed.data.id), eq(qaExports.orgId, ctx.orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Export not found.' } }, { status: 404 });

    return new NextResponse(row.csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="qa-${row.weekStart}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const { from, to } = parsed.data;
  const fromUtc = new Date(`${from}T00:00:00.000Z`);
  const toUtc = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromUtc.getTime()) || Number.isNaN(toUtc.getTime()) || toUtc <= fromUtc) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range.' } }, { status: 400 });
  }
  const rangeDays = (toUtc.getTime() - fromUtc.getTime()) / (24 * 60 * 60 * 1000);
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: `Range must be ${MAX_RANGE_DAYS} days or fewer.` } }, { status: 400 });
  }

  try {
    const config = await getOrCreateAgentConfig(ctx.orgId);
    // `to` is inclusive of the whole day, so the exclusive upper bound is +1 day.
    const periodEnd = new Date(toUtc.getTime() + 24 * 60 * 60 * 1000);
    const rows = await collectQaRows(ctx.orgId, fromUtc, periodEnd);
    const csv = toCsv(rows, config.timezone);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="qa-${from}_${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    log.error('[api/agent/qa-export] exception', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Export failed.' } }, { status: 500 });
  }
}
