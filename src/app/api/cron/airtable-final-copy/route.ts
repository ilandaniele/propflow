/**
 * POST /api/cron/airtable-final-copy?mode=dry-run|apply|report|recover|verify&limit=50[&after=<key>]
 * One-off: copies every file still referenced by an Airtable URL into our own
 * storage (see src/lib/airtable-final/copy.ts). `report` and `recover` take a
 * second pass over the permanent failures (src/lib/airtable-final/recover.ts);
 * `verify` compares one Airtable table per call with our copy (src/lib/airtable-final/verify.ts).
 * `after` is the `nextAfter` cursor of the previous call. Airtable is only read.
 * Triggered manually from the `airtable-final-copy` GitHub Actions workflow, not scheduled.
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
import { runRecoverBatch, type RecoverMode } from '@/lib/airtable-final/recover';
import { runVerifyTable } from '@/lib/airtable-final/verify';
import { db } from '@/lib/db';
import { withDbRetry } from '@/lib/db/retry';
import { log } from '@/lib/log';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_CURSOR_LENGTH = 500;
type Mode = CopyMode | RecoverMode | 'verify';
const MODES: ReadonlySet<string> = new Set<Mode>(['dry-run', 'apply', 'report', 'recover', 'verify']);

function parseMode(raw: string | null): Mode | null {
  if (raw === null) return 'dry-run';
  return MODES.has(raw) ? (raw as Mode) : null;
}

const isRecoverMode = (mode: Mode): mode is RecoverMode => mode === 'report' || mode === 'recover';

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
  const after = params.get('after');
  if (!mode || !limit || (after !== null && after.length > MAX_CURSOR_LENGTH)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'mode must be dry-run|apply|report|recover|verify, limit a positive integer' } },
      { status: 400 }
    );
  }

  try {
    // A batch mutates storage and the DB, so only the connection warm-up is retried (stale socket after Fly resume).
    await withDbRetry(() => db.execute(sql`SELECT 1`), 'cron/airtable-final-copy');
    const summary =
      mode === 'verify'
        ? await runVerifyTable({ after })
        : isRecoverMode(mode)
          ? await runRecoverBatch({ mode, limit, after })
          : await runCopyBatch({ mode, limit });
    return NextResponse.json({ status: 'ok', mode, ...summary });
  } catch (e) {
    log.error('[cron/airtable-final-copy] exception', { error: e instanceof Error ? e.message.slice(0, 80) : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Copy batch failed' } },
      { status: 500 }
    );
  }
}
