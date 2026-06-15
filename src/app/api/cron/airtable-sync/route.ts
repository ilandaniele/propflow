/**
 * POST /api/cron/airtable-sync
 * Daily 4:00 UTC cron — syncs all configured Airtable tables into:
 *   1. airtable_snapshots (raw JSON — existing behavior, AC10)
 *   2. main domain tables: properties, tenants, contracts, payments (new)
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC1).
 * Uses service-role Supabase client via syncAirtableTable / syncEntityTable
 * (cron runs outside any user session).
 *
 * Sync order for entities: properties → tenants → contracts → payments (IC4).
 * Per-entity failure is isolated — others continue (AC6, IC5).
 * Missing table env var → entity skipped, no log row written (AC7).
 *
 * Response: 200 JSON summary with snapshotResults + entityResults.
 *           500 only when ALL entity syncs fail.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncAirtableTable } from '@/lib/airtable/sync';
import { syncEntityTable, type EntityName, type IdMap } from '@/lib/airtable/sync-entities';
import { resolveEntityTableEnvKey } from '@/lib/airtable/env';
import { getAirtableClient } from '@/lib/airtable/client';

// ---------------------------------------------------------------------------
// Sync target lists
// ---------------------------------------------------------------------------

/** Legacy snapshot-only targets (rooms, performance, kpis) — AC10 preserved. */
const SYNC_TARGETS: Array<{ tableEnvKey: string; entity: string }> = [
  { tableEnvKey: 'AIRTABLE_TABLE_ROOMS',       entity: 'rooms' },
  { tableEnvKey: 'AIRTABLE_TABLE_PERFORMANCE', entity: 'performance' },
  { tableEnvKey: 'AIRTABLE_TABLE_KPIS',        entity: 'kpis' },
];

/**
 * Entity sync targets — ordered properties→responsables→units→service_payments→tenants→contracts→payments.
 *
 * Sync order rationale:
 *   1. properties         — no FK deps; populates propertiesMap
 *   2. responsables       — no FK deps; populates responsablesMap (needed by tenants)
 *   3. units              — needs propertiesMap; populates unitsMap (needed by tenants)
 *   4. service_payments   — needs propertiesMap (for property_id FK); single table in new schema
 *   5. tenants            — needs propertiesMap + unitsMap + responsablesMap
 *   6. contracts          — needs tenantsMap
 *   7. payments           — needs contractsMap + contract→tenant lookup
 */
const ENTITY_SYNC_TARGETS: Array<{ tableEnvKey: string; entity: EntityName }> = [
  { tableEnvKey: 'AIRTABLE_TABLE_PROPIEDADES',      entity: 'properties' },
  { tableEnvKey: 'AIRTABLE_TABLE_RESPONSABLES',     entity: 'responsables' },
  { tableEnvKey: 'AIRTABLE_TABLE_PORTAFOLIO',       entity: 'units' },
  { tableEnvKey: 'AIRTABLE_TABLE_PAGO_SERVICIOS',   entity: 'service_payments' },
  { tableEnvKey: 'AIRTABLE_TABLE_MANTENIMIENTO',    entity: 'incidents' },
  { tableEnvKey: 'AIRTABLE_TABLE_RESIDENTES',       entity: 'tenants' },
  { tableEnvKey: 'AIRTABLE_TABLE_HISTORIAL',        entity: 'contracts' },
  { tableEnvKey: 'AIRTABLE_TABLE_PAGOS',            entity: 'payments' },
];

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth: constant-time CRON_SECRET comparison (AC1) ─────────────────────
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
    return NextResponse.json({ status: 'ok', snapshotResults: [], entityResults: [] });
  }

  // ── Phase 1: Legacy snapshot sync (rooms/performance/kpis — AC10) ────────
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
          orgId,
          entity,
          count: result.count,
          status: result.status,
          logId: result.logId,
          durationMs: result.durationMs,
          errorMessage: result.errorMessage,
        });

        console.info('[cron/airtable-sync] snapshot synced', {
          orgId,
          entity,
          count: result.count,
          status: result.status,
          durationMs: result.durationMs,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        console.error('[cron/airtable-sync] snapshot sync failed', { orgId, entity, error: msg });
        snapshotResults.push({
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

  // ── Phase 2: Entity sync (properties/tenants/contracts/payments) ──────────
  const entityResults: Array<{
    orgId: string;
    entity: EntityName;
    count: number;
    skippedLinks: number;
    status: string;
    errorMessage?: string;
  }> = [];

  // Build the Airtable client once — it validates PAT/BASE_ID on construction.
  // If Airtable is not configured at all, skip entity sync entirely.
  let airtableClient;
  try {
    airtableClient = getAirtableClient();
  } catch (configErr) {
    const msg = configErr instanceof Error ? configErr.message : 'Airtable not configured';
    console.warn('[cron/airtable-sync] Airtable not configured — skipping entity sync:', msg);
    return NextResponse.json({
      status: 'ok',
      ran_at: new Date().toISOString(),
      snapshotResults,
      entityResults,
    });
  }

  for (const orgId of orgIds) {
    // idMaps persists across entity steps within a single org run (IC4 link resolution)
    const idMaps: Partial<Record<EntityName, IdMap>> = {};

    for (const { tableEnvKey, entity } of ENTITY_SYNC_TARGETS) {
      // AC7: skip when env var is absent
      const tableId = resolveEntityTableEnvKey(tableEnvKey);
      if (!tableId) {
        console.info(`[cron/airtable-sync] ${tableEnvKey} not set — skipping ${entity}`);
        // Populate empty idMap so downstream entities don't fail on a missing entry
        idMaps[entity] = new Map();
        continue;
      }

      // AC6: syncEntityTable catches its own errors and returns status='error'
      const result = await syncEntityTable(
        orgId,
        entity,
        tableEnvKey,
        adminClient,
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
        orgId,
        entity: result.entity,
        count: result.count,
        skippedLinks: result.skippedLinks,
        status: result.status,
      });
    }
  }

  // ── Build combined response ───────────────────────────────────────────────
  const snapshotErrorCount = snapshotResults.filter(r => r.status === 'error').length;
  const entityErrorCount   = entityResults.filter(r => r.status === 'error').length;
  const entityTotal        = entityResults.length;
  const allEntityFailed    = entityTotal > 0 && entityErrorCount === entityTotal;

  // IC5: 500 only when ALL entity syncs fail
  const httpStatus = allEntityFailed ? 500 : 200;
  const overallStatus =
    allEntityFailed
      ? 'error'
      : (snapshotErrorCount + entityErrorCount) === 0
        ? 'ok'
        : 'partial';

  return NextResponse.json(
    {
      status: overallStatus,
      ran_at: new Date().toISOString(),
      snapshotResults,
      entityResults,
    },
    { status: httpStatus }
  );
}
