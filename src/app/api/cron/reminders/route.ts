import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runReminderEngine } from '@/lib/notifications/reminder-engine';
import { assertServerEnv, env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * POST /api/cron/reminders
 * Called by Vercel Cron daily at 08:00 UTC.
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare)
 * No user session — uses service-role client (admin client).
 * Idempotent: dedup via reminders table.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Constant-time secret comparison (prevent timing attacks)
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = assertServerEnv('CRON_SECRET', 'cron reminders');
  const expected = `Bearer ${cronSecret}`;

  if (!timingSafeEqual(authHeader, expected)) {
    log.warn('[cron/reminders] unauthorized attempt');
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } }, { status: 401 });
  }

  try {
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

/**
 * Constant-time string comparison to prevent timing attacks.
 * Simple approach: compare character-by-character with fixed iterations.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to normalize timing
    let diff = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
    }
    return diff === 0 && false; // always false when lengths differ
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
