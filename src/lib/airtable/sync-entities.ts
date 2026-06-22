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
 *
 * NEVER import in 'use client' components.
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
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
import { normalizeAdditional } from '@/lib/airtable/normalizers/normalizeAdditional';
import { normalizeEECC } from '@/lib/airtable/normalizers/normalizeEECC';
import { normalizeTaxReceipt } from '@/lib/airtable/normalizers/normalizeTaxReceipt';
import { normalizeFeedback } from '@/lib/airtable/normalizers/normalizeFeedback';
import { getAirtableClient } from '@/lib/airtable/client';
import { db } from '@/lib/db';
import {
  units,
  contracts,
  tenants as tenantsTable,
  airtableSnapshots,
  airtableSyncLogs,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

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
  | 'service_payments'
  | 'incidents'
  | 'additional_charges'
  | 'account_statements'
  | 'tax_receipts'
  | 'tenant_feedback';

export interface EntitySyncResult {
  entity: EntityName;
  count: number;
  skippedLinks: number;
  status: 'success' | 'error' | 'partial';
  errorMessage?: string;
}

export type IdMap = Map<string, string>;
export type UnitMap = Map<string, string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityToDbTable(entity: EntityName): string {
  return entity;
}

function entityToSnapshotName(entity: EntityName): string {
  const map: Record<EntityName, string> = {
    properties:         'propiedades',
    tenants:            'residentes',
    contracts:          'historial',
    payments:           'movimientos',
    units:              'portafolio',
    incidents:          'mantenimiento',
    responsables:       'responsables',
    service_payments:   'pago_servicios',
    additional_charges: 'adicionales',
    account_statements: 'eecc',
    tax_receipts:       'impuestos_comprobantes',
    tenant_feedback:    'feedback',
  };
  return map[entity];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function syncEntityTable(
  orgId: string,
  entity: EntityName,
  tableEnvKey: string,
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
      await writeEntityLog({ orgId, entity, status: 'error', recordsUpserted: 0, errorMessage: msg, startedAt, completedAt: new Date() });
      return { entity, count: 0, skippedLinks: 0, status: 'error', errorMessage: msg };
    }

    if (records.length === 0) {
      await writeEntityLog({ orgId, entity, status: 'success', recordsUpserted: 0, startedAt, completedAt: new Date() });
      idMaps[entity] = new Map();
      return { entity, count: 0, skippedLinks: 0, status: 'success' };
    }

    // ── 2. Normalize + resolve links ─────────────────────────────────────────
    let skippedLinks = 0;

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

    if (entity === 'payments') {
      const contractRows = await db
        .select({ id: contracts.id, tenantId: contracts.tenantId })
        .from(contracts)
        .where(eq(contracts.orgId, orgId));

      const contractToTenantMap: Map<string, string> = new Map();
      for (const c of contractRows) {
        if (c.id && c.tenantId) contractToTenantMap.set(c.id, c.tenantId);
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
    const dbTable = entityToDbTable(entity);
    const BATCH = 200;
    let upsertedCount = 0;
    let upsertError: string | undefined;

    // W5c: Conflict detection for tenants
    if (entity === 'tenants' && domainRows.length > 0) {
      const airtableExtIds = domainRows
        .map(r => r['airtable_external_id'])
        .filter((id): id is string => typeof id === 'string');

      if (airtableExtIds.length > 0) {
        const existingTenants = await db
          .select({
            airtableExternalId: tenantsTable.airtableExternalId,
            updatedAt: tenantsTable.updatedAt,
            airtableSyncedAt: tenantsTable.airtableSyncedAt,
            syncStatus: tenantsTable.syncStatus,
          })
          .from(tenantsTable)
          .where(and(
            eq(tenantsTable.orgId, orgId),
            inArray(tenantsTable.airtableExternalId, airtableExtIds),
          ));

        if (existingTenants.length > 0) {
          const needsReviewIds = new Set<string>();
          const GRACE_MS = 60_000;
          for (const t of existingTenants) {
            if (
              t.updatedAt &&
              t.airtableSyncedAt &&
              new Date(t.updatedAt).getTime() > new Date(t.airtableSyncedAt).getTime() + GRACE_MS
            ) {
              if (t.airtableExternalId) needsReviewIds.add(t.airtableExternalId);
            }
          }

          if (needsReviewIds.size > 0) {
            console.info(`[sync-entities][tenants][${orgId}] conflict detected for ${needsReviewIds.size} tenant(s) — marking needs_review`);
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

    // Use raw SQL upsert for flexibility across all entity tables
    for (let i = 0; i < domainRows.length; i += BATCH) {
      const batch = domainRows.slice(i, i + BATCH);
      try {
        // Build parameterized upsert using raw SQL
        // This preserves the ON CONFLICT (org_id, airtable_external_id) behavior
        for (const row of batch) {
          const cols = Object.keys(row);
          const vals = Object.values(row);
          const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(', ');
          const setClauses = cols
            .filter(c => c !== 'id' && c !== 'org_id' && c !== 'airtable_external_id')
            .map(c => `${c} = EXCLUDED.${c}`)
            .join(', ');

          await db.execute(
            sql.raw(
              `INSERT INTO ${dbTable} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (org_id, airtable_external_id) DO UPDATE SET ${setClauses}`,
              vals
            )
          );
        }
        upsertedCount += batch.length;
      } catch (err) {
        upsertError = `[${entity}] upsert batch ${Math.floor(i / BATCH) + 1} failed: ${(err as Error).message}`;
        break;
      }
    }

    // ── 4. Upsert into airtable_snapshots (AC10 — raw JSON) ──────────────────
    const now = new Date();
    for (let i = 0; i < snapshotRows.length; i += BATCH) {
      const batch = snapshotRows.slice(i, i + BATCH);
      try {
        await db
          .insert(airtableSnapshots)
          .values(batch.map(r => ({
            orgId: r.org_id,
            tableName: r.table_name,
            externalId: r.external_id,
            data: r.data,
            syncedAt: now,
          })))
          .onConflictDoUpdate({
            target: [airtableSnapshots.orgId, airtableSnapshots.tableName, airtableSnapshots.externalId],
            set: { syncedAt: now },
          });
      } catch (err) {
        console.warn(`[sync-entities][${entity}] snapshot upsert batch failed: ${(err as Error).message}`);
      }
    }

    // ── 5. Build idMap for downstream link resolution ────────────────────────
    if (!upsertError) {
      const extIds = entity === 'service_payments'
        ? domainRows.map(r => r['airtable_external_id'] as string).filter(Boolean)
        : records.map(r => r.id);

      if (extIds.length > 0) {
        try {
          const freshRows = await db.execute(
            sql.raw(
              `SELECT id, airtable_external_id FROM ${dbTable} WHERE org_id = $1 AND airtable_external_id = ANY($2)`,
              [orgId, extIds]
            )
          ) as unknown as Array<{ id: string; airtable_external_id: string }>;

          if (freshRows) {
            const map: IdMap = new Map();
            for (const row of freshRows) {
              if (row.airtable_external_id) map.set(row.airtable_external_id, row.id);
            }
            idMaps[entity] = map;
          }
        } catch {
          idMaps[entity] = new Map();
        }
      } else {
        idMaps[entity] = new Map();
      }
    } else {
      idMaps[entity] = new Map();
    }

    // ── 6. Write sync log ─────────────────────────────────────────────────────
    const status = upsertError
      ? (upsertedCount > 0 ? 'partial' : 'error')
      : 'success';

    await writeEntityLog({
      orgId,
      entity,
      status,
      recordsUpserted: upsertedCount,
      errorMessage: upsertError,
      startedAt,
      completedAt: new Date(),
    });

    return { entity, count: upsertedCount, skippedLinks, status, errorMessage: upsertError };

  } catch (unexpected) {
    const msg = unexpected instanceof Error ? unexpected.message : 'Unexpected error';
    console.error(`[sync-entities][${entity}] unexpected error:`, msg);
    try {
      await writeEntityLog({ orgId, entity, status: 'error', recordsUpserted: 0, errorMessage: msg, startedAt, completedAt: new Date() });
    } catch { /* swallow */ }
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

  if (entity === 'service_payments') {
    const aggregated = aggregateServicePaymentRecords(records, orgId);
    const domainRows: Record<string, unknown>[] = [];
    for (const normalized of aggregated) {
      let propertyId: string | null = null;
      if (normalized._airtable_property_ext_id) {
        const resolved = idMaps.properties?.get(normalized._airtable_property_ext_id) ?? null;
        if (!resolved) {
          onUnresolved(`service_payments group ${normalized.airtable_external_id} → property ${normalized._airtable_property_ext_id} not in idMap`);
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

  const domainRows: Record<string, unknown>[] = [];
  const snapshotRows: BuiltRows['snapshotRows'] = [];

  for (const record of records) {
    const domainRow = buildDomainRow(entity, orgId, record, idMaps, unitMap, onUnresolved);

    if (domainRow['__skip'] === true) {
      snapshotRows.push({ org_id: orgId, table_name: snapshotTableName, external_id: record.id, data: { id: record.id, createdTime: record.createdTime, fields: record.fields }, synced_at: now });
      continue;
    }

    domainRows.push(domainRow);
    snapshotRows.push({ org_id: orgId, table_name: snapshotTableName, external_id: record.id, data: { id: record.id, createdTime: record.createdTime, fields: record.fields }, synced_at: now });
  }

  return { domainRows, snapshotRows };
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
        if (!resolved) onUnresolved(`tenant ${record.id} → property ${normalized._airtable_property_ext_id} not in idMap`);
        propertyId = resolved;
      }

      let unitId: string | null = null;
      if (propertyId && normalized._airtable_unit_label) {
        const mapKey = `${propertyId}::${normalized._airtable_unit_label}`;
        unitId = unitMap.get(mapKey) ?? null;
        if (!unitId) onUnresolved(`tenant ${record.id} → unit label "${normalized._airtable_unit_label}" not found in units for property ${propertyId}`);
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
          if (!responsableId) onUnresolved(`tenant ${record.id} → responsable ${responsableExtId} not in idMap`);
        }
      }

      const row = toDbRow(normalized);
      row['unit_id'] = unitId;
      if (responsableId !== null) row['responsable_id'] = responsableId;
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
        if (!resolved) onUnresolved(`payment ${record.id} → contract ${normalized._airtable_contract_ext_id} not in idMap`);
        contractId = resolved;
      }

      if (!contractId) {
        onUnresolved(`payment ${record.id} skipped: contract_id could not be resolved (NOT NULL)`);
        return { __skip: true };
      }

      const contractToTenantMap = idMaps['payments'] as Map<string, string> | undefined;
      if (contractToTenantMap) tenantId = contractToTenantMap.get(contractId) ?? null;
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
        if (!resolved) onUnresolved(`unit ${record.id} → property ${normalized._airtable_property_ext_id} not in idMap`);
        propertyId = resolved;
      }

      const row = toDbRow(normalized);
      if (propertyId !== null) row['property_id'] = propertyId;
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

    case 'additional_charges': {
      const normalized = normalizeAdditional(record);
      if (!normalized) {
        onUnresolved(`additional_charge ${record.id} skipped: amount missing or zero`);
        return { __skip: true };
      }

      let contractId: string | null = null;
      if (normalized.contractAirtableId) {
        contractId = idMaps.contracts?.get(normalized.contractAirtableId) ?? null;
        if (!contractId) onUnresolved(`additional_charge ${record.id} → contract ${normalized.contractAirtableId} not in idMap`);
      }

      let conceptId: string | null = null;
      if (normalized.conceptAirtableId) {
        conceptId = (idMaps as Record<string, IdMap | undefined>)['charge_concepts']?.get(normalized.conceptAirtableId) ?? null;
      }

      return {
        org_id:                orgId,
        airtable_external_id:  normalized.airtableExternalId,
        airtable_synced_at:    new Date().toISOString(),
        contract_id:           contractId,
        concept_id:            conceptId,
        mes:                   normalized.mes,
        anio:                  normalized.anio,
        amount:                normalized.amount,
        description:           normalized.description,
        numero:                normalized.numero,
      };
    }

    case 'account_statements': {
      const normalized = normalizeEECC(record);
      if (!normalized) return { __skip: true };

      let contractId: string | null = null;
      if (normalized.contractAirtableId) {
        contractId = idMaps.contracts?.get(normalized.contractAirtableId) ?? null;
        if (!contractId) onUnresolved(`account_statement ${record.id} → contract ${normalized.contractAirtableId} not in idMap`);
      }

      return {
        org_id:                  orgId,
        airtable_external_id:    normalized.airtableExternalId,
        airtable_synced_at:      new Date().toISOString(),
        contract_id:             contractId,
        eecc_code:               normalized.eeccCode,
        mes:                     normalized.mes,
        anio:                    normalized.anio,
        issue_date:              normalized.issueDate,
        due_date:                normalized.dueDate,
        pdf_url:                 normalized.pdfUrl,
        rent_amount:             normalized.rentAmount,
        additional_subtotal:     normalized.additionalSubtotal,
        previous_rent_balance:   normalized.previousRentBalance,
        previous_addl_balance:   normalized.previousAddlBalance,
        total_due:               normalized.totalDue,
        send_status:             normalized.sendStatus,
        send_date:               normalized.sendDate,
        whatsapp_message_id:     normalized.whatsappMessageId,
        send_error:              normalized.sendError,
      };
    }

    case 'tax_receipts': {
      const normalized = normalizeTaxReceipt(record);
      if (!normalized) return { __skip: true };

      let contractId: string | null = null;
      if (normalized.contractAirtableId) {
        contractId = idMaps.contracts?.get(normalized.contractAirtableId) ?? null;
        if (!contractId) onUnresolved(`tax_receipt ${record.id} → contract ${normalized.contractAirtableId} not in idMap`);
      }

      return {
        org_id:                orgId,
        airtable_external_id:  normalized.airtableExternalId,
        airtable_synced_at:    new Date().toISOString(),
        contract_id:           contractId,
        receipt_code:          normalized.receiptCode,
        tipo:                  normalized.tipo,
        numero:                normalized.numero,
        mes:                   normalized.mes,
        anio:                  normalized.anio,
        issue_date:            normalized.issueDate,
        base_amount:           normalized.baseAmount,
        includes_igv:          normalized.includesIgv,
        igv_amount:            normalized.igvAmount,
        total_amount:          normalized.totalAmount,
        status:                normalized.status,
        file_url:              normalized.fileUrl,
      };
    }

    case 'tenant_feedback': {
      const normalized = normalizeFeedback(record);
      if (!normalized) return { __skip: true };

      let tenantId: string | null = null;
      if (normalized.tenantAirtableId) {
        tenantId = idMaps.tenants?.get(normalized.tenantAirtableId) ?? null;
        if (!tenantId) onUnresolved(`tenant_feedback ${record.id} → tenant ${normalized.tenantAirtableId} not in idMap`);
      }

      return {
        org_id:               orgId,
        airtable_external_id: normalized.airtableExternalId,
        airtable_synced_at:   new Date().toISOString(),
        tenant_id:            tenantId,
        fecha:                normalized.fecha,
        cleaning_score:       normalized.cleaningScore,
        coexistence_score:    normalized.coexistenceScore,
        attention_score:      normalized.attentionScore,
        security_score:       normalized.securityScore,
        value_score:          normalized.valueScore,
        would_recommend:      normalized.wouldRecommend,
        comment:              normalized.comment,
        worst_experience:     normalized.worstExperience,
      };
    }
  }
}

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

async function writeEntityLog(params: EntityLogParams): Promise<void> {
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
    console.error(`[sync-entities] Failed to write sync log for ${params.entity}:`, (err as Error).message);
  }
}
