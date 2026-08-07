import { describe, it, expect } from 'vitest';
import {
  RECONCILABLE_ENTITIES,
  RECONCILE_GRACE_HOURS,
  isEntityReconcilable,
} from '@/lib/airtable/reconcile';

// These invariants guard a DELETE path. If they regress, the sync could remove
// live data — so they are locked down here.
describe('airtable reconcile — safety invariants', () => {
  it('grace window is at least 2 full daily-sync cycles (>= 48h)', () => {
    // A live row is re-upserted every daily run; the grace must exceed a couple
    // of cycles so a single missed/partial sync never deletes it.
    expect(RECONCILE_GRACE_HOURS).toBeGreaterThanOrEqual(48);
  });

  it('only reconciles safe LEAF tables — never parents or cascade tables', () => {
    const tables = RECONCILABLE_ENTITIES.map(e => e.table);
    // Parent tables (FK-referenced with cascade) and the cascade table itself
    // must never be reconciled, or a delete could remove far more than one row.
    const FORBIDDEN = ['tenants', 'contracts', 'units', 'properties', 'responsables', 'incidents', 'owners'];
    for (const forbidden of FORBIDDEN) {
      expect(tables, `${forbidden} must NOT be reconcilable`).not.toContain(forbidden);
    }
  });

  it('entity name matches table name for every entry (no typos)', () => {
    for (const { entity, table } of RECONCILABLE_ENTITIES) {
      expect(entity).toBe(table);
    }
    // Sanity: the expected leaf set is present.
    expect(RECONCILABLE_ENTITIES.map(e => e.table).sort()).toEqual(
      ['account_statements', 'additional_charges', 'payments', 'service_payments', 'tax_receipts', 'tenant_feedback'],
    );
  });

  describe('isEntityReconcilable — only success + count>0', () => {
    it('true when synced success with rows', () => {
      expect(isEntityReconcilable({ status: 'success', count: 5 })).toBe(true);
    });
    it('false when the entity did not sync this run (undefined)', () => {
      expect(isEntityReconcilable(undefined)).toBe(false);
    });
    it('false on an errored sync (never delete because a fetch failed)', () => {
      expect(isEntityReconcilable({ status: 'error', count: 10 })).toBe(false);
    });
    it('false on an empty fetch (count 0 — never wipe on an empty result)', () => {
      expect(isEntityReconcilable({ status: 'success', count: 0 })).toBe(false);
    });
    it('false on a partial status', () => {
      expect(isEntityReconcilable({ status: 'partial', count: 3 })).toBe(false);
    });
  });
});
