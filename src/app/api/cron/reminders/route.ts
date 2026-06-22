export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
// TODO(W6): runReminderEngine still expects a SupabaseClient; update lib in W6.
// For now we pass createAdminClient so the cron keeps functioning until W6 lands.
import { createAdminClient } from '@/lib/supabase/admin';
import { runReminderEngine } from '@/lib/notifications/reminder-engine';
import { assertServerEnv, env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * POST /api/cron/reminders
 * Called by Fly scheduled machine (replaces Vercel Cron).
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare)
 * No user session — uses service-role client (admin client).
 * Idempotent: dedup via reminders table.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Constant-time secret comparison (prevent timing attacks).
  // timingSafeEqual requires equal-length buffers — length check must precede the call.
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = assertServerEnv('CRON_SECRET', 'cron reminders');
  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/reminders] unauthorized attempt');
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } }, { status: 401 });
  }

  try {
    // TODO(W6): replace createAdminClient() with db once runReminderEngine is migrated to Drizzle.
    const adminClient = createAdminClient();
    const siteUrl = env.NEXT_PUBLIC_SITE_URL;

    const results = await runReminderEngine({ adminClient, siteUrl });

    const totalSent = results.reduce((s, r) => s + r.remindersSent, 0);
    const totalFailed = results.reduce((s, r) => s + r.remindersFailed, 0);

    log.info('[cron/reminders] run complete', {
      orgs: results.length,
      totalSent,
      totalFailed,
    });

    return NextResponse.json({ status: 'ok', orgs: results.length, totalSent, totalFailed });

  } catch (e) {
    // A10: fail-closed; no stack trace to response
    const msg = e instanceof Error ? e.message : 'unknown';
    log.error('[cron/reminders] exception', { error: msg });
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Cron failed' } }, { status: 500 });
  }
}
