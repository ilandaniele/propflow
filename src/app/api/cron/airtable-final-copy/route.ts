/**
 * POST /api/cron/airtable-final-copy?mode=dry-run|apply&limit=50
 * One-off: copies every file still referenced by an Airtable URL into our own
 * storage (see src/lib/airtable-final/copy.ts). Triggered manually from the
 * `airtable-final-copy` GitHub Actions workflow, not scheduled.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare).
 * Response: counts and `table.column#rowId` refs only — no URLs, no secrets.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { runCopyBatch, type CopyMode } from '@/lib/airtable-final/copy';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db/retry';
import { log } from '@/lib/log';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseMode(raw: string | null): CopyMode | null {
  if (raw === null) return 'dry-run';
  return raw === 'dry-run' || raw === 'apply' ? raw : null;
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? Math.min(n, MAX_LIMIT) : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.warn('[cron/airtable-final-copy] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/airtable-final-copy] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const mode = parseMode(params.get('mode'));
  const limit = parseLimit(params.get('limit'));
  if (!mode || !limit) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'mode must be dry-run|apply, limit a positive integer' } },
      { status: 400 }
    );
  }

  try {
    // A batch mutates storage and the DB, so only the connection warm-up is retried (stale socket after Fly resume).
    await withDbRetry(() => db.execute(sql`SELECT 1`), 'cron/airtable-final-copy');
    const summary = await runCopyBatch({ mode, limit });
    return NextResponse.json({ status: 'ok', mode, ...summary });
  } catch (e) {
    log.error('[cron/airtable-final-copy] exception', { error: e instanceof Error ? e.message.slice(0, 80) : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Copy batch failed' } },
      { status: 500 }
    );
  }
}
