/**
 * Brings airtable_snapshots up to date with Airtable today, one table per call.
 * Records changed in Airtable get their current fields; records we never had
 * are added; records deleted in Airtable are kept as they are. Before any row
 * is overwritten, its previous data is archived in storage, so nothing is lost.
 * Airtable is only read (GET).
 */

import { uploadFile } from '@/lib/storage';
import type { AirtableRecord } from './airtable';
import { ARCHIVE_BUCKET, ARCHIVE_PREFIX } from './fields';
import { insertSnapshotRows, listSnapshotTable, updateSnapshotRows, type SnapshotTableRow } from './store';
import { normalize, pickTable, readLiveTable } from './verify';

export interface RefreshTableSummary {
  table: string;
  updated: number;
  inserted: number;
  unchanged: number;
  /** New records left out because the table's snapshots do not belong to exactly one org. */
  skippedNoOrg: number;
}

export interface RefreshResult {
  table: RefreshTableSummary | null;
  error?: { table: string; reason: string };
  nextAfter: string | null;
}

export interface RefreshPlan {
  updates: SnapshotTableRow[];
  previous: SnapshotTableRow[];
  inserts: SnapshotTableRow[];
  unchanged: number;
  skippedNoOrg: number;
}

function fieldsOf(data: unknown): Record<string, unknown> {
  const fields = (data as { fields?: unknown } | null)?.fields;
  return typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>) : {};
}

function sameFields(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => normalize(a[k]) === normalize(b[k]));
}

export function planRefresh(records: readonly AirtableRecord[], snapshots: readonly SnapshotTableRow[]): RefreshPlan {
  const byId = new Map(snapshots.map((s) => [s.recordId, s]));
  const orgs = [...new Set(snapshots.map((s) => s.orgId))];
  const plan: RefreshPlan = { updates: [], previous: [], inserts: [], unchanged: 0, skippedNoOrg: 0 };

  for (const record of records) {
    const fields = record.fields ?? {};
    const stored = byId.get(record.id);
    if (!stored) {
      if (orgs.length === 1) plan.inserts.push({ orgId: orgs[0], recordId: record.id, data: { id: record.id, fields } });
      else plan.skippedNoOrg++;
    } else if (sameFields(fields, fieldsOf(stored.data))) {
      plan.unchanged++;
    } else {
      plan.previous.push(stored);
      plan.updates.push({ ...stored, data: { ...(stored.data as object), fields } });
    }
  }
  return plan;
}

async function archivePrevious(table: string, previous: readonly SnapshotTableRow[]): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const body = Buffer.from(JSON.stringify(previous));
  await uploadFile(ARCHIVE_BUCKET, `${ARCHIVE_PREFIX}/snapshots-before-refresh/${table}/${stamp}.json`, body, 'application/json', true);
}

/** Refreshes the first table (alphabetical) after `after`. */
export async function runRefreshTable({ after }: { after?: string | null }): Promise<RefreshResult> {
  const { table, nextAfter } = pickTable(after);
  if (!table) return { table: null, nextAfter: null };

  const live = await readLiveTable(table);
  if ('error' in live) return { table: null, error: { table, reason: live.error }, nextAfter };

  const plan = planRefresh(live.records, await listSnapshotTable(table));
  if (plan.previous.length > 0) await archivePrevious(table, plan.previous);
  await updateSnapshotRows(table, plan.updates);
  await insertSnapshotRows(table, plan.inserts);

  return {
    table: { table, updated: plan.updates.length, inserted: plan.inserts.length, unchanged: plan.unchanged, skippedNoOrg: plan.skippedNoOrg },
    nextAfter,
  };
}
