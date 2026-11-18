/**
 * Read-only check that everything in Airtable today is in our copy: every record
 * has a snapshot row with the same field values, and every attachment is in the
 * copy manifest (copied, or listed as a known permanent failure).
 * One Airtable table per call. Writes nothing anywhere.
 */

import { AirtableFetchError, AttachmentFetcher, readAirtableCredentials, resolveTableId, type AirtableRecord } from './airtable';
import { ATTACHMENT_COLUMNS, SNAPSHOT_TABLE_ENV } from './fields';
import { readManifest, type Manifest } from './manifest';
import { countPendingColumnRows, listSnapshotTable } from './store';

export interface VerifyTableSummary {
  table: string;
  airtableRecords: number;
  snapshotRecords: number;
  /** In Airtable, no snapshot row: data we do not have. */
  missingRecords: number;
  /** Snapshot row, no longer in Airtable. */
  deletedInAirtable: number;
  /** Field name -> records whose value differs between Airtable and the snapshot. */
  changedFields: Record<string, number>;
  attachments: number;
  attachmentsCopied: number;
  attachmentsLost: number;
  attachmentsMissing: number;
}

export interface VerifyResult {
  table: VerifyTableSummary | null;
  /** Set when the table could not be read; the run continues with the next one. */
  error?: { table: string; reason: string };
  /** DB column -> rows that still point at an Airtable URL. */
  columnsOnAirtable: Record<string, number>;
  nextAfter: string | null;
}

const TABLES = Object.keys(SNAPSHOT_TABLE_ENV).sort();

function isAttachmentList(value: unknown): value is Array<{ id: string; url: string }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string' && typeof (v as { url?: unknown }).url === 'string')
  );
}

/** Stable comparison value: attachments by id only (their URLs expire), objects with sorted keys. */
export function normalize(value: unknown): string {
  if (isAttachmentList(value)) return JSON.stringify(value.map((a) => a.id));
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function snapshotFields(data: unknown): Record<string, unknown> {
  const fields = (data as { fields?: unknown } | null)?.fields;
  return typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>) : {};
}

function attachmentIndex(manifest: Manifest) {
  const copied = new Set(Object.values(manifest.items).map((entry) => entry.attachmentId));
  const lost = new Set(Object.keys(manifest.failed ?? {}).map((key) => key.split('/').at(-1)!));
  return { copied, lost };
}

export function compareTable(
  table: string,
  records: readonly AirtableRecord[],
  snapshots: ReadonlyArray<{ recordId: string; data: unknown }>,
  manifest: Manifest,
): VerifyTableSummary {
  const byId = new Map(snapshots.map((s) => [s.recordId, snapshotFields(s.data)]));
  const live = new Set(records.map((r) => r.id));
  const { copied, lost } = attachmentIndex(manifest);
  const summary: VerifyTableSummary = {
    table,
    airtableRecords: records.length,
    snapshotRecords: snapshots.length,
    missingRecords: 0,
    deletedInAirtable: snapshots.filter((s) => !live.has(s.recordId)).length,
    changedFields: {},
    attachments: 0,
    attachmentsCopied: 0,
    attachmentsLost: 0,
    attachmentsMissing: 0,
  };

  for (const record of records) {
    const current = record.fields ?? {};
    const stored = byId.get(record.id);
    if (!stored) summary.missingRecords++;

    for (const value of Object.values(current)) {
      if (!isAttachmentList(value)) continue;
      for (const { id } of value) {
        summary.attachments++;
        if (copied.has(id)) summary.attachmentsCopied++;
        else if (lost.has(id)) summary.attachmentsLost++;
        else summary.attachmentsMissing++;
      }
    }

    if (!stored) continue;
    for (const field of new Set([...Object.keys(current), ...Object.keys(stored)])) {
      if (normalize(current[field]) !== normalize(stored[field])) {
        summary.changedFields[field] = (summary.changedFields[field] ?? 0) + 1;
      }
    }
  }
  return summary;
}

async function countColumnsOnAirtable(): Promise<Record<string, number>> {
  const counts = await Promise.all(ATTACHMENT_COLUMNS.map((col) => countPendingColumnRows(col)));
  return Object.fromEntries(ATTACHMENT_COLUMNS.map((col, i) => [`${col.dbTable}.${col.dbColumn}`, counts[i]]));
}

/** First snapshot table (alphabetical) after `after`, and the cursor for the call after it. */
export function pickTable(after?: string | null): { table: string | undefined; nextAfter: string | null } {
  const pending = TABLES.filter((t) => !after || t > after);
  return { table: pending[0], nextAfter: pending.length > 1 ? pending[0] : null };
}

/** Every record of one snapshot table as it is in Airtable today (GET only), or why it could not be read. */
export async function readLiveTable(table: string): Promise<{ records: AirtableRecord[] } | { error: string }> {
  const tableId = resolveTableId(SNAPSHOT_TABLE_ENV[table]);
  if (!tableId) return { error: 'table_not_configured' };
  try {
    return { records: await new AttachmentFetcher(readAirtableCredentials()).listAllRecords(tableId) };
  } catch (err) {
    return { error: err instanceof AirtableFetchError ? err.message : 'airtable_fetch_failed' };
  }
}

/** Verifies the first table (alphabetical) after `after`. */
export async function runVerifyTable({ after }: { after?: string | null }): Promise<VerifyResult> {
  const { table, nextAfter } = pickTable(after);
  const columnsOnAirtable = await countColumnsOnAirtable();
  if (!table) return { table: null, columnsOnAirtable, nextAfter: null };

  const live = await readLiveTable(table);
  if ('error' in live) return { table: null, error: { table, reason: live.error }, columnsOnAirtable, nextAfter };
  const [snapshots, manifest] = await Promise.all([listSnapshotTable(table), readManifest()]);
  return { table: compareTable(table, live.records, snapshots, manifest), columnsOnAirtable, nextAfter };
}
