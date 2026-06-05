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
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NormalizedProperty } from '@/lib/airtable/schemas';
import type { NormalizedTenant } from '@/lib/airtable/schemas';
import type { NormalizedContract } from '@/lib/airtable/schemas';
import type { NormalizedPayment } from '@/lib/airtable/schemas';
import { normalizeProperty } from '@/lib/airtable/normalizers/normalizeProperty';
import { normalizeTenant } from '@/lib/airtable/normalizers/normalizeTenant';
import { normalizeContract } from '@/lib/airtable/normalizers/normalizeContract';
import { normalizePayment } from '@/lib/airtable/normalizers/normalizePayment';
import { getAirtableClient } from '@/lib/airtable/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityName = 'properties' | 'tenants' | 'contracts' | 'payments';

export interface EntitySyncResult {
  entity: EntityName;
  /** Number of records successfully upserted into the main domain table */
  count: number;
  /** Number of linked-record FKs that could not be resolved and were set to NULL */
  skippedLinks: number;
  status: 'success' | 'error' | 'partial';
  errorMessage?: string;
}

// A Map<airtableExternalId, supabaseUuid> for each main table, built after upsert
// and handed to the next dependent entity's link resolver.
export type IdMap = Map<string, string>;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Sync a single entity table for one org.
 *
 * @param orgId           Organization UUID
 * @param entity          Which main table to target
 * @param tableEnvKey     Env-var key whose value is the Airtable table id/name
 * @param adminClient     Service-role Supabase client (shared across entity calls)
 * @param airtableClient  Injected for testability; defaults to singleton
 * @param idMaps          Map of entity → (airtableExtId → supabaseUuid) built by prior entity syncs
 *                        Used for FK resolution.  Properties populates idMaps.properties after upsert;
 *                        tenants populates idMaps.tenants, etc.
 * @returns               EntitySyncResult + (side effect) idMaps entry for this entity is populated
 */
export async function syncEntityTable(
  orgId: string,
  entity: EntityName,
  tableEnvKey: string,
  adminClient: SupabaseClient,
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
      await writeEntityLog(adminClient, { orgId, entity, status: 'error', recordsUpserted: 0, errorMessage: msg, startedAt, completedAt: new Date() });
      return { entity, count: 0, skippedLinks: 0, status: 'error', errorMessage: msg };
    }

    if (records.length === 0) {
      await writeEntityLog(adminClient, { orgId, entity, status: 'success', recordsUpserted: 0, startedAt, completedAt: new Date() });
      // Populate empty idMap so downstream entities don't fail on missing key
      idMaps[entity] = new Map();
      return { entity, count: 0, skippedLinks: 0, status: 'success' };
    }

    // ── 2. Normalize + resolve links ─────────────────────────────────────────
    let skippedLinks = 0;

    const { domainRows, snapshotRows } = buildRows(
      entity,
      orgId,
      records,
      idMaps,
      (warningMsg: string) => {
        // AC5: log warning to stdout; increment counter (we log once to airtable_sync_logs at end)
        console.warn(`[sync-entities][${entity}][${orgId}] unresolved link: ${warningMsg}`);
        skippedLinks++;
      }
    );

    // ── 3. Upsert into main domain table ─────────────────────────────────────
    const BATCH = 200;
    let upsertedCount = 0;
    let upsertError: string | undefined;

    for (let i = 0; i < domainRows.length; i += BATCH) {
      const batch = domainRows.slice(i, i + BATCH);
      const { error } = await adminClient
        .from(entity)
        .upsert(batch, {
          onConflict: 'org_id,airtable_external_id',
          ignoreDuplicates: false,
        });

      if (error) {
        upsertError = `[${entity}] upsert batch ${Math.floor(i / BATCH) + 1} failed: ${error.message}`;
        break;
      }
      upsertedCount += batch.length;
    }

    // ── 4. Upsert into airtable_snapshots (AC10 — raw JSON) ──────────────────
    // Continue even if domain upsert partially failed; snapshots are best-effort.
    for (let i = 0; i < snapshotRows.length; i += BATCH) {
      const batch = snapshotRows.slice(i, i + BATCH);
      const { error } = await adminClient
        .from('airtable_snapshots')
        .upsert(batch, {
          onConflict: 'org_id,table_name,external_id',
          ignoreDuplicates: false,
        });
      if (error) {
        console.warn(`[sync-entities][${entity}] snapshot upsert batch failed: ${error.message}`);
      }
    }

    // ── 5. Build idMap for downstream link resolution ────────────────────────
    // Query the just-upserted rows to get (airtable_external_id → id) mapping.
    // Only bother if later entities will use this map.
    if (!upsertError) {
      const extIds = records.map(r => r.id);
      const { data: freshRows } = await adminClient
        .from(entity)
        .select('id, airtable_external_id')
        .eq('org_id', orgId)
        .in('airtable_external_id', extIds);

      if (freshRows) {
        const map: IdMap = new Map();
        for (const row of freshRows as Array<{ id: string; airtable_external_id: string }>) {
          if (row.airtable_external_id) {
            map.set(row.airtable_external_id, row.id);
          }
        }
        idMaps[entity] = map;
      }
    } else {
      idMaps[entity] = new Map();
    }

    // ── 6. Write sync log ─────────────────────────────────────────────────────
    const status = upsertError
      ? (upsertedCount > 0 ? 'partial' : 'error')
      : 'success';

    const completedAt = new Date();
    await writeEntityLog(adminClient, {
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
    // AC6: catch-all so a single entity never aborts the run
    const msg = unexpected instanceof Error ? unexpected.message : 'Unexpected error';
    console.error(`[sync-entities][${entity}] unexpected error:`, msg);
    try {
      await writeEntityLog(adminClient, { orgId, entity, status: 'error', recordsUpserted: 0, errorMessage: msg, startedAt, completedAt: new Date() });
    } catch {
      // If logging itself fails, swallow so the outer loop continues
    }
    idMaps[entity] = new Map();
    return { entity, count: 0, skippedLinks: 0, status: 'error', errorMessage: msg };
  }
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
  onUnresolved: UnresolvedWarningCb
): BuiltRows {
  const now = new Date().toISOString();
  // Derive stable snapshot table_name from entity name (matches existing convention)
  const snapshotTableName = entityToSnapshotName(entity);

  const domainRows: Record<string, unknown>[] = [];
  const snapshotRows: BuiltRows['snapshotRows'] = [];

  for (const record of records) {
    const domainRow = buildDomainRow(entity, orgId, record, idMaps, onUnresolved);
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
  // Maps to the snapshot bucket name used by the legacy sync (table_name column).
  // Using entity name directly so it's clear and consistent.
  const map: Record<EntityName, string> = {
    properties: 'propiedades',
    tenants:    'residentes',
    contracts:  'historial',
    payments:   'pagos',
  };
  return map[entity];
}

function buildDomainRow(
  entity: EntityName,
  orgId: string,
  record: AirtableRecord,
  idMaps: Partial<Record<EntityName, IdMap>>,
  onUnresolved: UnresolvedWarningCb
): Record<string, unknown> {
  switch (entity) {
    case 'properties': {
      const normalized: NormalizedProperty = normalizeProperty(record, orgId);
      // Properties have no FK links to resolve — strip private fields (none in this type)
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

      // IC8: resolve unit_id by (property_id, label) — done post-upsert in a separate
      // pass at the route level (unit lookup requires DB query); here we set null.
      const row = toDbRow(normalized);
      row['property_id'] = propertyId;
      return row;
    }

    case 'contracts': {
      const normalized: NormalizedContract = normalizeContract(record, orgId);
      let tenantId: string | null = null;

      if (normalized._airtable_tenant_ext_id) {
        const resolved = idMaps.tenants?.get(normalized._airtable_tenant_ext_id) ?? null;
        if (!resolved) {
          onUnresolved(`contract ${record.id} → tenant ${normalized._airtable_tenant_ext_id} not in idMap`);
        }
        tenantId = resolved;
      }

      const row = toDbRow(normalized);
      row['tenant_id'] = tenantId;
      return row;
    }

    case 'payments': {
      const normalized: NormalizedPayment = normalizePayment(record, orgId);
      let contractId: string | null = null;

      if (normalized._airtable_contract_ext_id) {
        const resolved = idMaps.contracts?.get(normalized._airtable_contract_ext_id) ?? null;
        if (!resolved) {
          onUnresolved(`payment ${record.id} → contract ${normalized._airtable_contract_ext_id} not in idMap`);
        }
        contractId = resolved;
      }

      const row = toDbRow(normalized);
      row['contract_id'] = contractId;
      return row;
    }
  }
}

/**
 * Strip private _airtable_* helper fields from a normalized row before upsert.
 * These fields exist only for link resolution and must not reach the DB.
 * Also strips undefined values (Supabase client treats them differently from null).
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
  supabase: SupabaseClient,
  params: EntityLogParams
): Promise<void> {
  const { error } = await supabase
    .from('airtable_sync_logs')
    .insert({
      org_id:           params.orgId,
      table_name:       params.entity,
      status:           params.status,
      records_upserted: params.recordsUpserted,
      error_message:    params.errorMessage ?? null,
      started_at:       params.startedAt.toISOString(),
      completed_at:     params.completedAt.toISOString(),
    });

  if (error) {
    // Non-fatal: the sync may have succeeded; log to stdout only
    console.error(`[sync-entities] Failed to write sync log for ${params.entity}:`, error.message);
  }
}
