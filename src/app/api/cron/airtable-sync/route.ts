/**
 * POST /api/cron/airtable-sync
 * Fly scheduled machine (replaces Vercel Cron) — syncs all configured Airtable tables.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC10).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { syncAirtableTable } from '@/lib/airtable/sync';
import { syncEntityTable, type EntityName, type IdMap } from '@/lib/airtable/sync-entities';
import { RECONCILABLE_ENTITIES, isEntityReconcilable, RECONCILE_GRACE_HOURS } from '@/lib/airtable/reconcile';
import { resolveEntityTableEnvKey } from '@/lib/airtable/env';
import { getAirtableClient } from '@/lib/airtable/client';
import { withDbRetry } from '@/lib/db/retry';

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
  { tableEnvKey: 'AIRTABLE_TABLE_ADICIONALES',      entity: 'additional_charges' },
  { tableEnvKey: 'AIRTABLE_TABLE_EECC',             entity: 'account_statements' },
  { tableEnvKey: 'AIRTABLE_TABLE_IMPUESTOS',        entity: 'tax_receipts' },
  { tableEnvKey: 'AIRTABLE_TABLE_FEEDBACK',         entity: 'tenant_feedback' },
  { tableEnvKey: 'AIRTABLE_TABLE_PROPIETARIOS',     entity: 'owners' },
  { tableEnvKey: 'AIRTABLE_TABLE_CUENTAS_DEPOSITO', entity: 'deposit_accounts' },
  { tableEnvKey: 'AIRTABLE_TABLE_TURNOS_BASURA',    entity: 'trash_schedules' },
  { tableEnvKey: 'AIRTABLE_TABLE_CUMPL_BASURA',     entity: 'trash_compliance' },
  { tableEnvKey: 'AIRTABLE_TABLE_AUSENCIAS',        entity: 'absences' },
];

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth: constant-time CRON_SECRET comparison ────────────────────────────
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

  // ── Determine which orgs to sync — Drizzle query (AC1) ───────────────────
  let orgIds: string[];
  try {
    // First query after a Fly machine resume can hit a stale connection — retry.
    const rows = await withDbRetry(
      () => db.select({ id: organizations.id }).from(organizations),
      'cron/airtable-sync',
    );
    orgIds = rows.map(r => r.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[cron/airtable-sync] Failed to fetch orgs:', msg);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch organizations' } },
      { status: 500 }
    );
  }

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

  // ── Phase 3: Derive tenant.unit_id from active contracts ──────────────────
  // The Residentes table no longer carries the unit link (it lives in Historial/
  // Contratos), so tenants.unit_id can only be resolved AFTER contracts sync.
  // Set each tenant's unit from their most-recent active contract that has one.
  for (const orgId of orgIds) {
    try {
      await withDbRetry(() => db.execute(sql`
        UPDATE tenants t
        SET unit_id = sub.unit_id, updated_at = now()
        FROM (
          SELECT DISTINCT ON (tenant_id) tenant_id, unit_id
          FROM contracts
          WHERE org_id = ${orgId} AND status = 'active'
            AND unit_id IS NOT NULL AND tenant_id IS NOT NULL
          ORDER BY tenant_id, start_date DESC NULLS LAST
        ) sub
        WHERE t.id = sub.tenant_id AND t.org_id = ${orgId}
          AND t.unit_id IS DISTINCT FROM sub.unit_id
      `), 'cron/airtable-sync:derive-unit');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown error';
      console.error('[cron/airtable-sync] tenant unit_id derivation failed', { orgId, error: msg });
    }
  }

  // ── Phase 4: Reconcile source deletions (safe leaf mirror tables only) ─────
  // A read-only mirror upserts but never deletes, so rows removed from Airtable
  // linger and inflate financial totals. Remove them — but ONLY when it's safe:
  //   (a) the entity synced OK with count>0 this run (never delete because a
  //       fetch failed or returned empty), and
  //   (b) the row has been missing longer than the grace window. A live Airtable
  //       row is re-upserted every run, so its airtable_synced_at is always fresh
  //       and can never cross the grace window; a transient/partial fetch
  //       self-heals on the next sync. Only genuinely-deleted rows accumulate
  //       enough staleness to be removed.
  // Scope: leaf tables with no cascading children (verified). Parent tables
  // (tenants/contracts/units/…) and cascade tables (incidents) are excluded.
  const reconcileResults: Array<{ orgId: string; entity: EntityName; deleted: number }> = [];

  for (const orgId of orgIds) {
    for (const { entity, table } of RECONCILABLE_ENTITIES) {
      const res = entityResults.find(r => r.orgId === orgId && r.entity === entity);
      if (!isEntityReconcilable(res)) continue; // safety guard (a)
      try {
        const result = await withDbRetry(
          () => db.execute(sql`
            DELETE FROM ${sql.raw(table)}
            WHERE org_id = ${orgId}
              AND airtable_synced_at < now() - make_interval(hours => ${RECONCILE_GRACE_HOURS})
          `),
          `cron/airtable-sync:reconcile:${entity}`,
        );
        const deleted = (result as unknown as { count?: number }).count ?? 0;
        if (deleted > 0) {
          reconcileResults.push({ orgId, entity, deleted });
          console.info('[cron/airtable-sync] reconciled source deletions', { orgId, entity, deleted });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown error';
        console.error('[cron/airtable-sync] reconcile failed', { orgId, entity, error: msg });
      }
    }
  }

  // ── Build combined response ───────────────────────────────────────────────
  const snapshotErrorCount = snapshotResults.filter(r => r.status === 'error').length;
  const entityErrorCount   = entityResults.filter(r => r.status === 'error').length;
  const entityTotal        = entityResults.length;
  const allEntityFailed    = entityTotal > 0 && entityErrorCount === entityTotal;

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
      reconcileResults,
    },
    { status: httpStatus }
  );
}
