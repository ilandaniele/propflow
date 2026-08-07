/**
 * Reconciliation config for the Airtable sync (cron Phase 4).
 *
 * A read-only mirror upserts but never deletes, so rows removed from Airtable
 * linger in the DB and inflate financial totals. Phase 4 removes them — but only
 * safely. This module isolates the two safety invariants so they are unit-tested
 * and hard to regress:
 *
 *  1. Only LEAF tables with no cascading children may be reconciled. Deleting a
 *     parent row (tenant/contract/unit/property) or a cascade table (incidents)
 *     could remove far more than the stale row. Those are intentionally absent.
 *  2. An entity is only reconciled when its sync SUCCEEDED with count > 0 this
 *     run — a failed or empty fetch must never trigger deletes.
 *
 * Combined with the grace window (below), a live Airtable row — re-upserted every
 * run, so its airtable_synced_at is always fresh — can never be deleted; only
 * rows genuinely absent for 3+ days accumulate enough staleness to be removed.
 */

import type { EntityName } from './sync-entities';

/** Delete rows whose airtable_synced_at is older than this many hours. */
export const RECONCILE_GRACE_HOURS = 72;

/**
 * Safe leaf mirror tables eligible for deletion-reconciliation. Every entry is a
 * table that NOTHING FK-references with `onDelete: cascade` (verified against the
 * schema). Parent tables (tenants/contracts/units/properties/responsables) and
 * cascade tables (incidents) MUST NOT appear here.
 */
export const RECONCILABLE_ENTITIES: ReadonlyArray<{ entity: EntityName; table: string }> = [
  { entity: 'payments',           table: 'payments' },
  { entity: 'additional_charges', table: 'additional_charges' },
  { entity: 'account_statements', table: 'account_statements' },
  { entity: 'service_payments',   table: 'service_payments' },
  { entity: 'tax_receipts',       table: 'tax_receipts' },
  { entity: 'tenant_feedback',    table: 'tenant_feedback' },
];

/**
 * True only when this run's sync of the entity succeeded and touched at least one
 * row. Guards against deleting because a fetch failed or returned empty.
 */
export function isEntityReconcilable(
  res: { status: string; count: number } | undefined,
): boolean {
  return !!res && res.status === 'success' && res.count > 0;
}
