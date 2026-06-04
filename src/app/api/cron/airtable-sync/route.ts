/**
 * POST /api/cron/airtable-sync
 * Daily 4:00 UTC cron — syncs all configured Airtable tables into airtable_snapshots.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — same pattern
 * as existing cron routes).
 * Uses service-role Supabase client via syncAirtableTable (cron runs outside user session).
 *
 * Response: JSON summary with per-table counts and statuses.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncAirtableTable } from '@/lib/airtable/sync';

// Ordered list of (tableEnvKey, friendly name) pairs to sync on each run
const SYNC_TARGETS: Array<{ tableEnvKey: string; entity: string }> = [
  { tableEnvKey: 'AIRTABLE_TABLE_ROOMS',       entity: 'rooms' },
  { tableEnvKey: 'AIRTABLE_TABLE_PERFORMANCE', entity: 'performance' },
  { tableEnvKey: 'AIRTABLE_TABLE_KPIS',        entity: 'kpis' },
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth: constant-time CRON_SECRET comparison ───────────────────────────
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/airtable-sync] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual   = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    console.warn('[cron/airtable-sync] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  // ── Determine which orgs to sync ─────────────────────────────────────────
  // We sync all organizations that have at least one admin profile.
  const adminClient = createAdminClient();
  const { data: orgs, error: orgsError } = await adminClient
    .from('organizations')
    .select('id');

  if (orgsError) {
    console.error('[cron/airtable-sync] Failed to fetch orgs:', orgsError.message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch organizations' } },
      { status: 500 }
    );
  }

  const orgIds = (orgs ?? []).map((o: { id: string }) => o.id);

  if (orgIds.length === 0) {
    console.info('[cron/airtable-sync] No organizations found — nothing to sync');
    return NextResponse.json({ status: 'ok', results: [] });
  }

  // ── Run sync for each org × each table ───────────────────────────────────
  const results: Array<{
    orgId: string;
    entity: string;
    count: number;
    status: string;
    logId: string;
    durationMs: number;
    errorMessage?: string;
  }> = [];

  const activeSyncTargets = SYNC_TARGETS.filter(t => !!process.env[t.tableEnvKey]);

  for (const orgId of orgIds) {
    for (const { tableEnvKey, entity } of activeSyncTargets) {
      try {
        const result = await syncAirtableTable(orgId, tableEnvKey);
        results.push({
          orgId,
          entity,
          count: result.count,
          status: result.status,
          logId: result.logId,
          durationMs: result.durationMs,
          errorMessage: result.errorMessage,
        });

        console.info('[cron/airtable-sync] synced', {
          orgId,
          entity,
          count: result.count,
          status: result.status,
          durationMs: result.durationMs,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        console.error('[cron/airtable-sync] sync failed', { orgId, entity, error: msg });
        results.push({
          orgId,
          entity,
          count: 0,
          status: 'error',
          logId: 'unknown',
          durationMs: 0,
          errorMessage: msg,
        });
      }
    }
  }

  const totalUpserted = results.reduce((sum, r) => sum + r.count, 0);
  const errorCount = results.filter(r => r.status === 'error').length;

  return NextResponse.json({
    status: errorCount === 0 ? 'ok' : 'partial',
    totalUpserted,
    errorCount,
    results,
  });
}
