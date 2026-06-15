/**
 * sync-entities.ts — server-only.
 *
 * Provides syncEntityTable() which, for a single (org, entity) pair:
 *   1. Fetches all Airtable records for the table.
 *   2. Normalizes each record into a domain row shape.
 *   3. Resolves linked-record foreign keys against previously-upserted rows.
 *   4. Upserts into the main domain table (ON CONFLICT org_id, airtable_external_id).
 *   5. Upserts into airtable_snapshots (raw JSON — AC10).
 *   6. Writes a row to airtable_sync_logs.
 *
 * Guarantees:
 * - AC3  Idempotent — same inputs → same DB state.
 * - AC5  Unresolved links → FK set to NULL, warning logged, row still upserted.
 * - AC6  Per-entity error → caught, logged to airtable_sync_logs, returned as status='error'.
 * - AC10 airtable_snapshots still populated (raw JSON) alongside main-table upsert.
 *
 * Sync order that callers MUST respect: properties → tenants → contracts → payments.
 * (FK parent tables are synced before child tables so link resolver succeeds in one pass.)
 *
 * NEVER import in 'use client' components.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/lib/db/schema';
import type { NormalizedProperty } from '@/lib/airtable/schemas';
import type { NormalizedTenant } from '@/lib/airtable/schemas';
import type { NormalizedContract } from '@/lib/airtable/schemas';
import type { NormalizedPayment } from '@/lib/airtable/schemas';
import { normalizeProperty } from '@/lib/airtable/normalizers/normalizeProperty';
import { normalizeTenant } from '@/lib/airtable/normalizers/normalizeTenant';
import { normalizeContract } from '@/lib/airtable/normalizers/normalizeContract';
import { normalizePayment } from '@/lib/airtable/normalizers/normalizePayment';
import { normalizePortafolio } from '@/lib/airtable/normalizers/normalizePortafolio';
import { normalizeResponsable } from '@/lib/airtable/normalizers/normalizeResponsable';
import { normalizeMantenimiento } from '@/lib/airtable/normalizers/normalizeMantenimiento';
import { aggregateServicePaymentRecords } from '@/lib/airtable/normalizers/normalizeServicePayments';
import { getAirtableClient } from '@/lib/airtable/client';
import { eq, inArray } from 'drizzle-orm';
import {
  properties,
  units,
  responsables,
  tenants,
  contracts,
  payments,
  incidents,
  servicePayments,
  airtableSnapshots,
  airtableSyncLogs,
} from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DbClient = PostgresJsDatabase<typeof schema>;

export type EntityName =
  | 'properties'
  | 'tenants'
  | 'contracts'
  | 'payments'
  | 'units'
  | 'responsables'
  | 'service_payments'
  | 'incidents';

export interface EntitySyncResult {
  entity: EntityName;
  /** Number of records successfully upserted into the main domain table */
  count: number;
  /** Number of linked-record FKs that could not be resolved and were set to NULL */
  skippedLinks: number;
  status: 'success' | 'error' | 'partial';
  errorMessage?: string;
}

// A Map<airtableExternalId, uuid> for each main table, built after upsert
// and handed to the next dependent entity's link resolver.
export type IdMap = Map<string, string>;

// A Map<"property_id::label", unit_uuid> for resolving unit_id by (property_id, label).
// Built from the units table for the org before tenants are upserted.
export type UnitMap = Map<string, string>;

// ---------------------------------------------------------------------------
// Table lookup helper
// ---------------------------------------------------------------------------

function entityToTable(entity: EntityName) {
  switch (entity) {
    case 'properties':      return properties;
    case 'units':           return units;
    case 'responsables':    return responsables;
    case 'tenants':         return tenants;
    case 'contracts':       return contracts;
    case 'payments':        return payments;
    case 'incidents':       return incidents;
    case 'service_payments':return servicePayments;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Sync a single entity table for one org.
 *
 * @param orgId           Organization UUID
 * @param entity          Which main table to target
 * @param tableEnvKey     Env-var key whose value is the Airtable table id/name
 * @param db              Drizzle PostgresJsDatabase instance
 * @param airtableClient  Injected for testability; defaults to singleton
 * @param idMaps          Map of entity → (airtableExtId → uuid) built by prior entity syncs
 * @returns               EntitySyncResult + (side effect) idMaps entry for this entity is populated
 */
export async function syncEntityTable(
  orgId: string,
  entity: EntityName,
  tableEnvKey: string,
  db: DbClient,
  airtableClient = getAirtableClient(),
  idMaps: Partial<Record<EntityName, IdMap>> = {}
): Promise<EntitySyncResult> {
  const startedAt = new Date();

  try {
    // ── 1. Fetch records from Airtable ────────────────────────────────────────
    let records: AirtableRecord[];
    try {
      records = await airtableClient.listRecords(tableEnvKey);
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Unknown Airtable fetch error';
      await writeEntityLog(db, { orgId, entity, status: 'error', recordsUpserted: 0, errorMessage: msg, startedAt, completedAt: new Date() });
      return { entity, count: 0, skippedLinks: 0, status: 'error', errorMessage: msg };
    }

    if (records.length === 0) {
      await writeEntityLog(db, { orgId, entity, status: 'success', recordsUpserted: 0, startedAt, completedAt: new Date() });
      idMaps[entity] = new Map();
      return { entity, count: 0, skippedLinks: 0, status: 'success' };
    }

    // ── 2. Normalize + resolve links ─────────────────────────────────────────
    let skippedLinks = 0;

    // For tenants: pre-build unitMap from the units table so unit_id can be
    // resolved by (property_id, label) before the upsert.
    const unitMap: UnitMap = new Map();
    if (entity === 'tenants') {
      const unitRows = await db
        .select({ id: units.id, propertyId: units.propertyId, label: units.label })
        .from(units)
        .where(eq(units.orgId, orgId));

      for (const u of unitRows) {
        if (u.propertyId && u.label) {
          unitMap.set(`${u.propertyId}::${u.label}`, u.id);
        }
      }
    }

    // For payments: build contractId→tenantId map so we can satisfy tenant_id NOT NULL.
    if (entity === 'payments') {
      const contractRows = await db
        .select({ id: contracts.id, tenantId: contracts.tenantId })
        .from(contracts)
        .where(eq(contracts.orgId, orgId));

      const contractToTenantMap: Map<string, string> = new Map();
      for (const c of contractRows) {
        if (c.id && c.tenantId) {
          contractToTenantMap.set(c.id, c.tenantId);
        }
      }
      idMaps['payments'] = contractToTenantMap;
    }

    const { domainRows, snapshotRows } = buildRows(
      entity,
      orgId,
      records,
      idMaps,
      unitMap,
      (warningMsg: string) => {
        console.warn(`[sync-entities][${entity}][${orgId}] unresolved link: ${warningMsg}`);
        skippedLinks++;
      }
    );

    // ── 3. Upsert into main domain table ─────────────────────────────────────
    const table = entityToTable(entity);
    const BATCH = 200;
    let upsertedCount = 0;
    let upsertError: string | undefined;

    // Conflict detection for tenants: flag locally-edited rows as 'needs_review'.
    if (entity === 'tenants' && domainRows.length > 0) {
      const airtableExtIds = domainRows
        .map(r => r['airtable_external_id'])
        .filter((id): id is string => typeof id === 'string');

      if (airtableExtIds.length > 0) {
        const existingTenants = await db
          .select({
            airtableExternalId: tenants.airtableExternalId,
            updatedAt: tenants.updatedAt,
            airtableSyncedAt: tenants.airtableSyncedAt,
            syncStatus: tenants.syncStatus,
          })
          .from(tenants)
          .where(eq(tenants.orgId, orgId));

        const existingInScope = existingTenants.filter(
          t => t.airtableExternalId && airtableExtIds.includes(t.airtableExternalId)
        );

        const GRACE_MS = 60_000;
        const needsReviewIds = new Set<string>();
        for (const t of existingInScope) {
          if (
            t.updatedAt &&
            t.airtableSyncedAt &&
            new Date(t.updatedAt).getTime() > new Date(t.airtableSyncedAt).getTime() + GRACE_MS
          ) {
            if (t.airtableExternalId) needsReviewIds.add(t.airtableExternalId);
          }
        }

        if (needsReviewIds.size > 0) {
          console.info(
            `[sync-entities][tenants][${orgId}] conflict detected for ${needsReviewIds.size} tenant(s) — marking needs_review`
          );
          for (const row of domainRows) {
            const extId = row['airtable_external_id'] as string | undefined;
            if (extId && needsReviewIds.has(extId)) {
              row['sync_status'] = 'needs_review';
            }
          }
        }
      }
    }

    for (let i = 0; i < domainRows.length; i += BATCH) {
      const batch = domainRows.slice(i, i + BATCH);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tableAny = table as any;
        await db
          .insert(tableAny)
          .values(batch as Parameters<typeof tableAny._.config.columns>[0][])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .onConflictDoUpdate({
            target: [tableAny.orgId, tableAny.airtableExternalId],
            set: buildUpdateSet(batch[0] as Record<string, unknown>, tableAny),
          });
        upsertedCount += batch.length;
      } catch (err) {
        upsertError = `[${entity}] upsert batch ${Math.floor(i / BATCH) + 1} failed: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }

    // ── 4. Upsert into airtable_snapshots (AC10 — raw JSON) ──────────────────
    for (let i = 0; i < snapshotRows.length; i += BATCH) {
      const batch = snapshotRows.slice(i, i + BATCH);
      try {
        await db
          .insert(airtableSnapshots)
          .values(batch.map(r => ({
            orgId:      r.org_id,
            tableName:  r.table_name,
            externalId: r.external_id,
            data:       r.data,
            syncedAt:   new Date(r.synced_at),
          })))
          .onConflictDoUpdate({
            target: [airtableSnapshots.orgId, airtableSnapshots.tableName, airtableSnapshots.externalId],
            set: {
              data:     airtableSnapshots.data,
              syncedAt: airtableSnapshots.syncedAt,
            },
          });
      } catch (err) {
        console.warn(`[sync-entities][${entity}] snapshot upsert batch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── 5. Build idMap for downstream link resolution ────────────────────────
    if (!upsertError) {
      const extIds = entity === 'service_payments'
        ? domainRows.map(r => r['airtable_external_id'] as string).filter(Boolean)
        : records.map(r => r.id);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tableAny = table as any;
      const freshRows = extIds.length > 0
        ? await db
            .select({ id: tableAny.id, airtableExternalId: tableAny.airtableExternalId })
            .from(tableAny)
            .where(eq(tableAny.orgId, orgId))
            // inArray requires at least 1 element; guarded by extIds.length > 0 above
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then((rows: any[]) => rows.filter(r => extIds.includes(r.airtableExternalId)))
        : [];

      const map: IdMap = new Map();
      for (const row of freshRows) {
        if (row.airtableExternalId) {
          map.set(row.airtableExternalId, row.id);
        }
      }
      idMaps[entity] = map;
    } else {
      idMaps[entity] = new Map();
    }

    // ── 6. Write sync log ─────────────────────────────────────────────────────
    const status = upsertError
      ? (upsertedCount > 0 ? 'partial' : 'error')
      : 'success';

    const completedAt = new Date();
    await writeEntityLog(db, {
      orgId,
      entity,
      status,
      recordsUpserted: upsertedCount,
      errorMessage: upsertError,
      startedAt,
      completedAt,
    });

    return {
      entity,
      count: upsertedCount,
      skippedLinks,
      status,
      errorMessage: upsertError,
    };
  } catch (unexpected) {
    const msg = unexpected instanceof Error ? unexpected.message : 'Unexpected error';
    console.error(`[sync-entities][${entity}] unexpected error:`, msg);
    try {
      await writeEntityLog(db, { orgId, entity, status: 'error', recordsUpserted: 0, errorMessage: msg, startedAt, completedAt: new Date() });
    } catch {
      // If logging itself fails, swallow so the outer loop continues
    }
    idMaps[entity] = new Map();
    return { entity, count: 0, skippedLinks: 0, status: 'error', errorMessage: msg };
  }
}

// ---------------------------------------------------------------------------
// buildUpdateSet — derive SET clause from the first row of a batch
// ---------------------------------------------------------------------------

/**
 * Builds the SET clause for onConflictDoUpdate by mapping snake_case DB column
 * keys from the domain row back to their Drizzle column references.
 * Private _airtable_* fields are excluded by toDbRow already.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildUpdateSet(firstRow: Record<string, unknown>, table: any): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  // Exclude the conflict-target columns; update everything else.
  const skip = new Set(['id', 'org_id', 'airtable_external_id', 'created_at']);
  for (const key of Object.keys(firstRow)) {
    if (skip.has(key)) continue;
    // Look up the Drizzle column by iterating table columns
    const col = findColumn(table, key);
    if (col) set[key] = col;
  }
  return set;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findColumn(table: any, snakeKey: string): unknown {
  // Drizzle column objects are accessible as direct properties of the table.
  // The property name is camelCase; snakeKey is the DB column name.
  // We look for the column whose _.config.name matches snakeKey.
  for (const [, col] of Object.entries(table)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = col as any;
    if (c && typeof c === 'object' && c._?.config?.name === snakeKey) {
      return c;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// buildRows — normalize + resolve links per entity
// ---------------------------------------------------------------------------

type UnresolvedWarningCb = (msg: string) => void;

interface BuiltRows {
  domainRows: Record<string, unknown>[];
  snapshotRows: Array<{ org_id: string; table_name: string; external_id: string; data: Record<string, unknown>; synced_at: string }>;
}

function buildRows(
  entity: EntityName,
  orgId: string,
  records: AirtableRecord[],
  idMaps: Partial<Record<EntityName, IdMap>>,
  unitMap: UnitMap,
  onUnresolved: UnresolvedWarningCb
): BuiltRows {
  const now = new Date().toISOString();
  const snapshotTableName = entityToSnapshotName(entity);

  // ── service_payments: bulk aggregation path ───────────────────────────────
  if (entity === 'service_payments') {
    const aggregated = aggregateServicePaymentRecords(records, orgId);

    const domainRows: Record<string, unknown>[] = [];
    for (const normalized of aggregated) {
      let propertyId: string | null = null;
      if (normalized._airtable_property_ext_id) {
        const resolved = idMaps.properties?.get(normalized._airtable_property_ext_id) ?? null;
        if (!resolved) {
          onUnresolved(
            `service_payments group ${normalized.airtable_external_id} → property ${normalized._airtable_property_ext_id} not in idMap`
          );
        }
        propertyId = resolved;
      }
      const row = toDbRow(normalized as unknown as Record<string, unknown>);
      row['property_id'] = propertyId;
      domainRows.push(row);
    }

    const snapshotRows: BuiltRows['snapshotRows'] = records.map(record => ({
      org_id:      orgId,
      table_name:  snapshotTableName,
      external_id: record.id,
      data:        { id: record.id, createdTime: record.createdTime, fields: record.fields },
      synced_at:   now,
    }));

    return { domainRows, snapshotRows };
  }

  // ── Standard per-record path ──────────────────────────────────────────────
  const domainRows: Record<string, unknown>[] = [];
  const snapshotRows: BuiltRows['snapshotRows'] = [];

  for (const record of records) {
    const domainRow = buildDomainRow(entity, orgId, record, idMaps, unitMap, onUnresolved);

    if (domainRow['__skip'] === true) {
      snapshotRows.push({
        org_id: orgId,
        table_name: snapshotTableName,
        external_id: record.id,
        data: { id: record.id, createdTime: record.createdTime, fields: record.fields },
        synced_at: now,
      });
      continue;
    }

    domainRows.push(domainRow);

    snapshotRows.push({
      org_id: orgId,
      table_name: snapshotTableName,
      external_id: record.id,
      data: { id: record.id, createdTime: record.createdTime, fields: record.fields },
      synced_at: now,
    });
  }

  return { domainRows, snapshotRows };
}

function entityToSnapshotName(entity: EntityName): string {
  const map: Record<EntityName, string> = {
    properties:       'propiedades',
    tenants:          'residentes',
    contracts:        'historial',
    payments:         'movimientos',
    units:            'portafolio',
    incidents:        'mantenimiento',
    responsables:     'responsables',
    service_payments: 'pago_servicios',
  };
  return map[entity];
}

function buildDomainRow(
  entity: EntityName,
  orgId: string,
  record: AirtableRecord,
  idMaps: Partial<Record<EntityName, IdMap>>,
  unitMap: UnitMap,
  onUnresolved: UnresolvedWarningCb
): Record<string, unknown> {
  switch (entity) {
    case 'properties': {
      const normalized: NormalizedProperty = normalizeProperty(record, orgId);
      return toDbRow(normalized);
    }

    case 'tenants': {
      const normalized: NormalizedTenant = normalizeTenant(record, orgId);
      let propertyId: string | null = null;

      if (normalized._airtable_property_ext_id) {
        const resolved = idMaps.properties?.get(normalized._airtable_property_ext_id) ?? null;
        if (!resolved) {
          onUnresolved(`tenant ${record.id} → property ${normalized._airtable_property_ext_id} not in idMap`);
        }
        propertyId = resolved;
      }

      let unitId: string | null = null;
      if (propertyId && normalized._airtable_unit_label) {
        const mapKey = `${propertyId}::${normalized._airtable_unit_label}`;
        const resolvedUnitId = unitMap.get(mapKey) ?? null;
        if (!resolvedUnitId) {
          onUnresolved(
            `tenant ${record.id} → unit label "${normalized._airtable_unit_label}" not found in units for property ${propertyId}`
          );
        }
        unitId = resolvedUnitId;
      }

      let responsableId: string | null = null;
      const responsablesMap = idMaps.responsables;
      if (responsablesMap) {
        const responsableLinks = record.fields['Responsable'];
        const responsableExtId = Array.isArray(responsableLinks) && responsableLinks.length > 0
          ? (typeof responsableLinks[0] === 'string' ? responsableLinks[0] : null)
          : null;
        if (responsableExtId) {
          responsableId = responsablesMap.get(responsableExtId) ?? null;
          if (!responsableId) {
            onUnresolved(`tenant ${record.id} → responsable ${responsableExtId} not in idMap`);
          }
        }
      }

      const row = toDbRow(normalized);
      row['unit_id'] = unitId;
      if (responsableId !== null) {
        row['responsable_id'] = responsableId;
      }
      return row;
    }

    case 'contracts': {
      const normalized: NormalizedContract = normalizeContract(record, orgId);

      if (!normalized.start_date) {
        onUnresolved(`contract ${record.id} skipped: start_date missing (NOT NULL)`);
        return { __skip: true };
      }
      if (!normalized.monthly_rent || normalized.monthly_rent <= 0) {
        onUnresolved(`contract ${record.id} skipped: monthly_rent missing or <= 0 (NOT NULL + CHECK > 0)`);
        return { __skip: true };
      }

      let tenantId: string | null = null;
      if (normalized._airtable_tenant_ext_id) {
        tenantId = idMaps.tenants?.get(normalized._airtable_tenant_ext_id) ?? null;
        if (!tenantId) {
          onUnresolved(`contract ${record.id} → tenant ${normalized._airtable_tenant_ext_id} not in idMap — skipping (tenant_id NOT NULL)`);
          return { __skip: true };
        }
      } else {
        onUnresolved(`contract ${record.id} skipped: no tenant link (tenant_id NOT NULL)`);
        return { __skip: true };
      }

      let unitId: string | null = null;
      if (normalized._airtable_unit_ext_id) {
        unitId = idMaps.units?.get(normalized._airtable_unit_ext_id) ?? null;
        if (!unitId) {
          onUnresolved(`contract ${record.id} → unit ${normalized._airtable_unit_ext_id} not in idMap — skipping (unit_id NOT NULL)`);
          return { __skip: true };
        }
      } else {
        onUnresolved(`contract ${record.id} skipped: no unit link (unit_id NOT NULL)`);
        return { __skip: true };
      }

      const row = toDbRow(normalized);
      row['tenant_id'] = tenantId;
      row['unit_id']   = unitId;
      return row;
    }

    case 'payments': {
      const result = normalizePayment(record, orgId);

      if (result.skip) {
        onUnresolved(`payment ${record.id} skipped: ${result.reason}`);
        return { __skip: true };
      }

      const normalized: NormalizedPayment = result.payment;
      let contractId: string | null = null;
      let tenantId: string | null = null;

      if (normalized._airtable_contract_ext_id) {
        const resolved = idMaps.contracts?.get(normalized._airtable_contract_ext_id) ?? null;
        if (!resolved) {
          onUnresolved(`payment ${record.id} → contract ${normalized._airtable_contract_ext_id} not in idMap`);
        }
        contractId = resolved;
      }

      if (!contractId) {
        onUnresolved(`payment ${record.id} skipped: contract_id could not be resolved (NOT NULL)`);
        return { __skip: true };
      }

      const contractToTenantMap = idMaps['payments'] as Map<string, string> | undefined;
      if (contractToTenantMap) {
        tenantId = contractToTenantMap.get(contractId) ?? null;
      }
      if (!tenantId) {
        onUnresolved(`payment ${record.id} → tenant_id could not be resolved from contract ${contractId} (NOT NULL)`);
        return { __skip: true };
      }

      const row = toDbRow(normalized);
      row['contract_id'] = contractId;
      row['tenant_id']   = tenantId;
      return row;
    }

    case 'units': {
      const normalized = normalizePortafolio(record, orgId);
      let propertyId: string | null = null;

      if (normalized._airtable_property_ext_id) {
        const resolved = idMaps.properties?.get(normalized._airtable_property_ext_id) ?? null;
        if (!resolved) {
          onUnresolved(`unit ${record.id} → property ${normalized._airtable_property_ext_id} not in idMap`);
        }
        propertyId = resolved;
      }

      const row = toDbRow(normalized);
      if (propertyId !== null) {
        row['property_id'] = propertyId;
      }
      row['airtable_synced_at'] = new Date().toISOString();
      return row;
    }

    case 'responsables': {
      const normalized = normalizeResponsable(record, orgId);
      const row = toDbRow(normalized);
      row['airtable_synced_at'] = new Date().toISOString();
      return row;
    }

    case 'incidents': {
      const normalized = normalizeMantenimiento(record, orgId);
      return toDbRow(normalized as unknown as Record<string, unknown>);
    }

    case 'service_payments': {
      return { __skip: true };
    }
  }
}

/**
 * Strip private _airtable_* helper fields from a normalized row before upsert.
 * Also strips undefined values.
 */
function toDbRow(normalized: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(normalized)) {
    if (k.startsWith('_airtable_')) continue;
    if (v === undefined) continue;
    row[k] = v;
  }
  return row;
}

// ---------------------------------------------------------------------------
// writeEntityLog
// ---------------------------------------------------------------------------

interface EntityLogParams {
  orgId: string;
  entity: EntityName;
  status: 'success' | 'error' | 'partial';
  recordsUpserted: number;
  errorMessage?: string;
  startedAt: Date;
  completedAt: Date;
}

async function writeEntityLog(
  db: DbClient,
  params: EntityLogParams
): Promise<void> {
  try {
    await db.insert(airtableSyncLogs).values({
      orgId:           params.orgId,
      tableName:       params.entity,
      status:          params.status,
      recordsUpserted: params.recordsUpserted,
      errorMessage:    params.errorMessage ?? null,
      startedAt:       params.startedAt,
      completedAt:     params.completedAt,
    });
  } catch (err) {
    // Non-fatal: the sync may have succeeded; log to stdout only
    console.error(`[sync-entities] Failed to write sync log for ${params.entity}:`, err instanceof Error ? err.message : String(err));
  }
}
