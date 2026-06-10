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
import { normalizePortafolio } from '@/lib/airtable/normalizers/normalizePortafolio';
import { normalizeResponsable } from '@/lib/airtable/normalizers/normalizeResponsable';
import { aggregateServicePaymentRecords } from '@/lib/airtable/normalizers/normalizeServicePayments';
import { getAirtableClient } from '@/lib/airtable/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityName =
  | 'properties'
  | 'tenants'
  | 'contracts'
  | 'payments'
  | 'units'
  | 'responsables'
  | 'service_payments';

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

// A Map<"property_id::label", unit_uuid> for resolving unit_id by (property_id, label).
// Built from the units table for the org before tenants are upserted.
export type UnitMap = Map<string, string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map entity name to the Supabase DB table name.
 */
function entityToDbTable(entity: EntityName): string {
  return entity;
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

    // IC8: for tenants, pre-build a unitMap from the units table so unit_id can be
    // resolved by (property_id, label) before the upsert — avoids a separate UPDATE pass.
    // This query is cheap (org-scoped, small table) and runs only for the tenants entity.
    const unitMap: UnitMap = new Map();
    if (entity === 'tenants') {
      const { data: unitRows } = await adminClient
        .from('units')
        .select('id, property_id, label')
        .eq('org_id', orgId);

      if (unitRows) {
        for (const u of unitRows as Array<{ id: string; property_id: string; label: string }>) {
          if (u.property_id && u.label) {
            unitMap.set(`${u.property_id}::${u.label}`, u.id);
          }
        }
      }
    }

    // For payments: build a contractId→tenantId map so we can satisfy tenant_id NOT NULL.
    // The contracts sync ran before payments (IC4), so contracts rows exist in the DB.
    // We store this map under idMaps['payments'] so buildDomainRow can access it.
    if (entity === 'payments') {
      const { data: contractRows } = await adminClient
        .from('contracts')
        .select('id, tenant_id')
        .eq('org_id', orgId);

      const contractToTenantMap: Map<string, string> = new Map();
      if (contractRows) {
        for (const c of contractRows as Array<{ id: string; tenant_id: string | null }>) {
          if (c.id && c.tenant_id) {
            contractToTenantMap.set(c.id, c.tenant_id);
          }
        }
      }
      // Stash it; buildDomainRow reads idMaps['payments'] for this lookup
      idMaps['payments'] = contractToTenantMap;
    }

    const { domainRows, snapshotRows } = buildRows(
      entity,
      orgId,
      records,
      idMaps,
      unitMap,
      (warningMsg: string) => {
        // AC5: log warning to stdout; increment counter (we log once to airtable_sync_logs at end)
        console.warn(`[sync-entities][${entity}][${orgId}] unresolved link: ${warningMsg}`);
        skippedLinks++;
      }
    );

    // ── 3. Upsert into main domain table ─────────────────────────────────────
    const dbTable = entityToDbTable(entity);
    const BATCH = 200;
    let upsertedCount = 0;
    let upsertError: string | undefined;

    // W5c: Conflict detection for tenants.
    // Any tenant that has been locally edited in PropFlow after the last Airtable sync
    // is flagged as 'needs_review' so the admin can reconcile manually.
    // We still upsert Airtable data for all records — the flag is additive, not a skip.
    if (entity === 'tenants' && domainRows.length > 0) {
      const airtableExtIds = domainRows
        .map(r => r['airtable_external_id'])
        .filter((id): id is string => typeof id === 'string');

      if (airtableExtIds.length > 0) {
        const { data: existingTenants } = await adminClient
          .from('tenants')
          .select('airtable_external_id, updated_at, airtable_synced_at, sync_status')
          .eq('org_id', orgId)
          .in('airtable_external_id', airtableExtIds);

        if (existingTenants) {
          const needsReviewIds = new Set<string>();
          for (const t of existingTenants as Array<{
            airtable_external_id: string;
            updated_at: string | null;
            airtable_synced_at: string | null;
            sync_status: string | null;
          }>) {
            if (
              t.updated_at &&
              t.airtable_synced_at &&
              new Date(t.updated_at) > new Date(t.airtable_synced_at)
            ) {
              needsReviewIds.add(t.airtable_external_id);
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
    }

    for (let i = 0; i < domainRows.length; i += BATCH) {
      const batch = domainRows.slice(i, i + BATCH);
      const { error } = await adminClient
        .from(dbTable)
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
      // For service_payments, the external_id is synthetic ("recXXX::serviceType")
      // Collect them from domainRows which have the correct synthetic ids
      const extIds = entity === 'service_payments'
        ? domainRows.map(r => r['airtable_external_id'] as string).filter(Boolean)
        : records.map(r => r.id);
      const { data: freshRows } = await adminClient
        .from(dbTable)
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
  unitMap: UnitMap,
  onUnresolved: UnresolvedWarningCb
): BuiltRows {
  const now = new Date().toISOString();
  const snapshotTableName = entityToSnapshotName(entity);

  // ── service_payments: bulk aggregation path ───────────────────────────────
  // All records are processed together so that monthly_data can be grouped by
  // (property, serviceType). This is a special-case that bypasses buildDomainRow.
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

    // Snapshots — one per raw record (not per aggregated row)
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

    // Filter sentinel rows that were marked as skip by normalizers
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
  // Maps to the snapshot bucket name used by the legacy sync (table_name column).
  const map: Record<EntityName, string> = {
    properties:       'propiedades',
    tenants:          'residentes',
    contracts:        'historial',
    payments:         'movimientos',
    units:            'portafolio',
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

      // IC8: resolve unit_id by (property_id, label) using the pre-built unitMap.
      // unitMap keys are "property_id::label"; both components must be non-null to resolve.
      // If not found, unit_id stays null and a warning is logged (AC5 null-FK-continue pattern).
      // WARNING: never interpolate PII field values (dni, birth_date, first_name, last_name)
      // here — log only Airtable record IDs.
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

      // Resolve responsable_id from responsablesMap if available.
      // The Residentes table has a linked Responsables field — extract the first linked id
      // from the raw record directly, as NormalizedTenant doesn't carry this field yet.
      let responsableId: string | null = null;
      const responsablesMap = idMaps.responsables;
      if (responsablesMap) {
        // Extract first linked id from the 'Responsable' field (may be array of rec ids)
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
      row['property_id'] = propertyId;
      row['unit_id'] = unitId;
      if (responsableId !== null) {
        row['responsable_id'] = responsableId;
      }
      return row;
    }

    case 'contracts': {
      const normalized: NormalizedContract = normalizeContract(record, orgId);

      // Skip rows that can't satisfy NOT NULL constraints:
      //   tenant_id NOT NULL — must resolve from idMaps.tenants
      //   unit_id   NOT NULL — must resolve from idMaps.units (via _airtable_unit_ext_id)
      //   start_date NOT NULL
      //   monthly_rent NOT NULL + CHECK > 0
      // This mirrors the skip pattern used for payments.
      if (!normalized.start_date) {
        onUnresolved(`contract ${record.id} skipped: start_date missing (NOT NULL)`);
        return { __skip: true };
      }
      if (!normalized.monthly_rent || normalized.monthly_rent <= 0) {
        onUnresolved(`contract ${record.id} skipped: monthly_rent missing or <= 0 (NOT NULL + CHECK > 0)`);
        return { __skip: true };
      }

      // Resolve tenant_id — required (NOT NULL)
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

      // Resolve unit_id — required (NOT NULL)
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

      // normalizePayment now returns a discriminated union — skip rows that
      // cannot satisfy DB NOT NULL constraints (amount=0, dates missing, etc.)
      if (result.skip) {
        onUnresolved(`payment ${record.id} skipped: ${result.reason}`);
        // Return a sentinel that buildRows will filter out
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

      // If contract was unresolved, we cannot satisfy contract_id NOT NULL — skip
      if (!contractId) {
        onUnresolved(`payment ${record.id} skipped: contract_id could not be resolved (NOT NULL)`);
        return { __skip: true };
      }

      // Resolve tenant_id via contractsMap → tenantsMap (two-hop resolution)
      // The contractIdToTenantId map is passed via idMaps under key 'payments'
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
      // Only set property_id when we have a resolved value; never overwrite with null
      // to avoid clobbering a value set by a previous sync or manual edit.
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

    case 'service_payments': {
      // service_payments uses bulk aggregation in buildRows — this per-record
      // path should never be reached; return empty sentinel.
      return { __skip: true };
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
