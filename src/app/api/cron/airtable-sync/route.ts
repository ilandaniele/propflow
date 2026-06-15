/**
 * POST /api/cron/airtable-sync
 * Daily 4:00 UTC cron — syncs all configured Airtable tables into:
 *   1. airtable_snapshots (raw JSON — existing behavior)
 *   2. main domain tables: properties, tenants, contracts, payments
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC18).
 *
 * NOTE (W5): passes db as `any` to syncEntityTable — W6 will update the
 * syncEntityTable signature to accept Drizzle db natively.
 *
 * Response: 200 JSON summary with snapshotResults + entityResults.
 *           500 only when ALL entity syncs fail.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { syncAirtableTable } from '@/lib/airtable/sync';
import { syncEntityTable, type EntityName, type IdMap } from '@/lib/airtable/sync-entities';
import { resolveEntityTableEnvKey } from '@/lib/airtable/env';
import { getAirtableClient } from '@/lib/airtable/client';

// ---------------------------------------------------------------------------
// Sync target lists
// ---------------------------------------------------------------------------

const SYNC_TARGETS: Array<{ tableEnvKey: string; entity: string }> = [
  { tableEnvKey: 'AIRTABLE_TABLE_ROOMS',       entity: 'rooms' },
  { tableEnvKey: 'AIRTABLE_TABLE_PERFORMANCE', entity: 'performance' },
  { tableEnvKey: 'AIRTABLE_TABLE_KPIS',        entity: 'kpis' },
];

const ENTITY_SYNC_TARGETS: Array<{ tableEnvKey: string; entity: EntityName }> = [
  { tableEnvKey: 'AIRTABLE_TABLE_PROPIEDADES',    entity: 'properties' },
  { tableEnvKey: 'AIRTABLE_TABLE_RESPONSABLES',   entity: 'responsables' },
  { tableEnvKey: 'AIRTABLE_TABLE_PORTAFOLIO',     entity: 'units' },
  { tableEnvKey: 'AIRTABLE_TABLE_PAGO_SERVICIOS', entity: 'service_payments' },
  { tableEnvKey: 'AIRTABLE_TABLE_MANTENIMIENTO',  entity: 'incidents' },
  { tableEnvKey: 'AIRTABLE_TABLE_RESIDENTES',     entity: 'tenants' },
  { tableEnvKey: 'AIRTABLE_TABLE_HISTORIAL',      entity: 'contracts' },
  { tableEnvKey: 'AIRTABLE_TABLE_PAGOS',          entity: 'payments' },
];

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth: constant-time CRON_SECRET comparison (AC18)
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

  // Determine which orgs to sync — using Drizzle
  const orgRows = await db.select({ id: organizations.id }).from(organizations);
  const orgIds = orgRows.map(o => o.id);

  if (orgIds.length === 0) {
    console.info('[cron/airtable-sync] No organizations found — nothing to sync');
    return NextResponse.json({ status: 'ok', snapshotResults: [], entityResults: [] });
  }

  // W6: db is now typed as PostgresJsDatabase — no cast needed

  // Phase 1: Legacy snapshot sync (rooms/performance/kpis)
  const snapshotResults: Array<{
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
        snapshotResults.push({
          orgId, entity,
          count: result.count, status: result.status, logId: result.logId,
          durationMs: result.durationMs, errorMessage: result.errorMessage,
        });
        console.info('[cron/airtable-sync] snapshot synced', { orgId, entity, count: result.count, status: result.status });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        console.error('[cron/airtable-sync] snapshot sync failed', { orgId, entity, error: msg });
        snapshotResults.push({ orgId, entity, count: 0, status: 'error', logId: 'unknown', durationMs: 0, errorMessage: msg });
      }
    }
  }

  // Phase 2: Entity sync (properties/tenants/contracts/payments)
  const entityResults: Array<{
    orgId: string;
    entity: EntityName;
    count: number;
    skippedLinks: number;
    status: string;
    errorMessage?: string;
  }> = [];

  let airtableClient;
  try {
    airtableClient = getAirtableClient();
  } catch (configErr) {
    const msg = configErr instanceof Error ? configErr.message : 'Airtable not configured';
    console.warn('[cron/airtable-sync] Airtable not configured — skipping entity sync:', msg);
    return NextResponse.json({ status: 'ok', ran_at: new Date().toISOString(), snapshotResults, entityResults });
  }

  for (const orgId of orgIds) {
    const idMaps: Partial<Record<EntityName, IdMap>> = {};

    for (const { tableEnvKey, entity } of ENTITY_SYNC_TARGETS) {
      const tableId = resolveEntityTableEnvKey(tableEnvKey);
      if (!tableId) {
        console.info(`[cron/airtable-sync] ${tableEnvKey} not set — skipping ${entity}`);
        idMaps[entity] = new Map();
        continue;
      }

      const result = await syncEntityTable(
        orgId,
        entity,
        tableEnvKey,
        db,
        airtableClient,
        idMaps
      );

      entityResults.push({
        orgId,
        entity: result.entity,
        count: result.count,
        skippedLinks: result.skippedLinks,
        status: result.status,
        errorMessage: result.errorMessage,
      });

      console.info('[cron/airtable-sync] entity synced', {
        orgId, entity: result.entity, count: result.count, status: result.status,
      });
    }
  }

  const snapshotErrorCount = snapshotResults.filter(r => r.status === 'error').length;
  const entityErrorCount   = entityResults.filter(r => r.status === 'error').length;
  const entityTotal        = entityResults.length;
  const allEntityFailed    = entityTotal > 0 && entityErrorCount === entityTotal;

  const httpStatus = allEntityFailed ? 500 : 200;
  const overallStatus =
    allEntityFailed ? 'error'
    : (snapshotErrorCount + entityErrorCount) === 0 ? 'ok'
    : 'partial';

  return NextResponse.json(
    { status: overallStatus, ran_at: new Date().toISOString(), snapshotResults, entityResults },
    { status: httpStatus }
  );
}
