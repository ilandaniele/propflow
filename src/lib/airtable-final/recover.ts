/**
 * Second pass over the copy's permanent failures (`manifest.failed`).
 *
 * Airtable is only read: one GET per 10 records and one GET per file. Nothing in
 * Airtable is changed.
 *
 * report:  diagnoses every failure and writes nothing.
 * recover: copies each file that can be found again into our storage, records it
 *          in `manifest.items` (status `recovered`) and drops it from `manifest.failed`.
 *          A DB column that still holds its expired Airtable URL gets the new path
 *          when the file type fits that column; otherwise the file is archived under
 *          `airtable-archive/recovered/` and the failure stays listed for the column.
 *
 * Output carries manifest keys, table/field names and reason codes only — never
 * URLs, file names or secrets.
 */

import { log } from '@/lib/log';
import { buildCopyPath, sanitizeSegment, sniffCopyMime } from './attachments';
import { storeBytes } from './copy';
import {
  AirtableFetchError,
  AttachmentFetcher,
  readAirtableCredentials,
  resolveTableId,
  type AirtableAttachment,
  type AttachmentsByRecord,
} from './airtable';
import { CopyError, downloadBytes, isUrlAlive } from './download';
import { ARCHIVE_BUCKET, ARCHIVE_PREFIX, ATTACHMENT_COLUMNS, SNAPSHOT_TABLE_ENV, type AttachmentColumn } from './fields';
import { readManifest, writeManifest, type Manifest } from './manifest';
import { findColumnRows, listSnapshotRows, setColumnValue } from './store';

export type RecoverMode = 'report' | 'recover';

/** What Airtable holds today for a failed attachment. */
export type FailedVerdict =
  | 'same_id_same_field'   // the attachment is where it was (the failure was its file type or a transient error)
  | 'same_id_other_field'  // same attachment, field renamed or moved
  | 'same_name_size'       // re-uploaded: same file name and size, new attachment id
  | 'same_name'            // same file name, size unknown or different
  | 'stored_url_alive'     // gone from the record, but the URL we stored still serves the file
  | 'record_deleted'       // the record is gone from Airtable
  | 'not_found';           // the record exists but nothing matches

const RECOVERABLE: ReadonlySet<FailedVerdict> = new Set([
  'same_id_same_field',
  'same_id_other_field',
  'same_name_size',
  'same_name',
  'stored_url_alive',
]);

export interface RecoverGroup {
  table: string;
  field: string;
  reason: string;
  verdict: FailedVerdict;
  count: number;
}

export interface RecoverSummary {
  /** Failures in the manifest before this call. */
  total: number;
  processed: number;
  recovered: number;
  /** Pass as `after` to continue; null when every failure was processed. */
  nextAfter: string | null;
  groups: RecoverGroup[];
  errors: Array<{ ref: string; reason: string }>;
}

/** One failed manifest entry, with what we knew about the file before it failed. */
export interface FailedItem {
  key: string;
  reason: string;
  /** Snapshot table name, or the DB table for a column failure. */
  table: string;
  field: string;
  recordId: string;
  envKey: string;
  attachmentId: string | null;
  filename: string | null;
  size: number | null;
  storedUrl: string | null;
  column?: { col: AttachmentColumn; rowId: string; orgId: string; value: string };
}

const COLUMN_PREFIX = 'column:';

/** `column:<dbTable>.<dbColumn>#<rowId>` */
function parseColumnKey(key: string): { col: AttachmentColumn; rowId: string } | null {
  const m = /^column:([a-z_]+)\.([a-z_]+)#(.+)$/.exec(key);
  if (!m) return null;
  const col = ATTACHMENT_COLUMNS.find((c) => c.dbTable === m[1] && c.dbColumn === m[2]);
  return col ? { col, rowId: m[3] } : null;
}

/** `<table>/<recordId>/<field>/<attachmentId>`; the field name may itself contain `/`. */
function parseSnapshotKey(key: string): { table: string; recordId: string; field: string; attachmentId: string } | null {
  const parts = key.split('/');
  if (parts.length < 4) return null;
  return { table: parts[0], recordId: parts[1], field: parts.slice(2, -1).join('/'), attachmentId: parts[parts.length - 1] };
}

interface StoredAttachment {
  id: string;
  url: string;
  filename?: string;
  size?: number;
}

function snapshotAttachments(data: unknown, field: string): StoredAttachment[] {
  const value = (data as { fields?: Record<string, unknown> } | null)?.fields?.[field];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is StoredAttachment =>
      typeof v === 'object' && v !== null && typeof (v as StoredAttachment).id === 'string' && typeof (v as StoredAttachment).url === 'string',
  );
}

const snapshotTableForEnv = (envKey: string) =>
  Object.entries(SNAPSHOT_TABLE_ENV).find(([, env]) => env === envKey)?.[0] ?? null;

/** Builds the failed items with the metadata the snapshots and DB still hold. */
export async function loadFailedItems(failed: Record<string, string>): Promise<FailedItem[]> {
  const snapshots = new Map<string, unknown>();
  for (const row of await listSnapshotRows()) snapshots.set(`${row.table}/${row.recordId}`, row.data);

  const columnKeys = new Map<AttachmentColumn, string[]>();
  for (const key of Object.keys(failed)) {
    const parsed = key.startsWith(COLUMN_PREFIX) ? parseColumnKey(key) : null;
    if (parsed) columnKeys.set(parsed.col, [...(columnKeys.get(parsed.col) ?? []), parsed.rowId]);
  }
  const columnRows = new Map<string, { recordId: string; orgId: string; value: string }>();
  for (const [col, rowIds] of columnKeys) {
    for (const row of await findColumnRows(col, rowIds)) columnRows.set(`${col.dbTable}#${row.id}`, row);
  }

  const items: FailedItem[] = [];
  for (const [key, reason] of Object.entries(failed).sort(([a], [b]) => a.localeCompare(b))) {
    if (key.startsWith(COLUMN_PREFIX)) {
      const parsed = parseColumnKey(key);
      const row = parsed && columnRows.get(`${parsed.col.dbTable}#${parsed.rowId}`);
      if (!parsed || !row) continue;
      const snapTable = snapshotTableForEnv(parsed.col.airtableTable);
      const first = snapTable ? snapshotAttachments(snapshots.get(`${snapTable}/${row.recordId}`), parsed.col.airtableField)[0] : undefined;
      items.push({
        key,
        reason,
        table: parsed.col.dbTable,
        field: parsed.col.dbColumn,
        recordId: row.recordId,
        envKey: parsed.col.airtableTable,
        attachmentId: first?.id ?? null,
        filename: first?.filename ?? null,
        size: first?.size ?? null,
        storedUrl: row.value,
        column: { col: parsed.col, rowId: parsed.rowId, orgId: row.orgId, value: row.value },
      });
      continue;
    }
    const parsed = parseSnapshotKey(key);
    if (!parsed || !(parsed.table in SNAPSHOT_TABLE_ENV)) continue;
    const stored = snapshotAttachments(snapshots.get(`${parsed.table}/${parsed.recordId}`), parsed.field).find(
      (a) => a.id === parsed.attachmentId,
    );
    items.push({
      key,
      reason,
      table: parsed.table,
      field: parsed.field,
      recordId: parsed.recordId,
      envKey: SNAPSHOT_TABLE_ENV[parsed.table],
      attachmentId: parsed.attachmentId,
      filename: stored?.filename ?? null,
      size: stored?.size ?? null,
      storedUrl: stored?.url ?? null,
    });
  }
  return items;
}

export interface Match {
  verdict: FailedVerdict;
  /** Where to download the file from (fresh Airtable URL or the stored one). */
  url?: string;
  /** The matched attachment as Airtable lists it today. */
  attachment?: AirtableAttachment;
}

/** Looks for the failed file in the record's current fields. Pure. */
export function matchCurrent(item: FailedItem, current: Record<string, AirtableAttachment[]> | undefined): Match | null {
  if (!current) return null;
  const all = Object.entries(current).flatMap(([field, list]) => list.map((a) => ({ field, a })));
  const expectedField = item.column ? item.column.col.airtableField : item.field;

  if (item.attachmentId) {
    const byId = all.filter(({ a }) => a.id === item.attachmentId);
    const same = byId.find(({ field }) => field === expectedField);
    if (same) return { verdict: 'same_id_same_field', url: same.a.url, attachment: same.a };
    if (byId[0]) return { verdict: 'same_id_other_field', url: byId[0].a.url, attachment: byId[0].a };
  } else if (item.column) {
    // No snapshot to compare with: whatever the column's field holds now is the file.
    const first = current[expectedField]?.[0];
    if (first) return { verdict: 'same_id_same_field', url: first.url, attachment: first };
  }

  if (item.filename) {
    const byName = all.filter(({ a }) => a.filename === item.filename);
    const sized = item.size != null ? byName.find(({ a }) => a.size === item.size) : undefined;
    if (sized) return { verdict: 'same_name_size', url: sized.a.url, attachment: sized.a };
    if (byName[0]) return { verdict: 'same_name', url: byName[0].a.url, attachment: byName[0].a };
  }
  return null;
}

async function diagnose(item: FailedItem, fresh: AttachmentsByRecord): Promise<Match> {
  const current = fresh.get(item.recordId);
  const match = matchCurrent(item, current);
  if (match) return match;
  if (item.storedUrl && (await isUrlAlive(item.storedUrl))) return { verdict: 'stored_url_alive', url: item.storedUrl };
  return { verdict: current ? 'not_found' : 'record_deleted' };
}

function recoveredPath(item: FailedItem, match: Match): string {
  const id = match.attachment?.id ?? item.attachmentId ?? item.recordId;
  const name = sanitizeSegment(`${id}_${match.attachment?.filename ?? item.filename ?? 'file'}`);
  return `${ARCHIVE_PREFIX}/recovered/${sanitizeSegment(item.table)}/${sanitizeSegment(item.recordId)}/${sanitizeSegment(item.field)}/${name}`;
}

async function recoverOne(item: FailedItem, match: Match, manifest: Manifest): Promise<void> {
  const body = await downloadBytes(match.url!);
  const mime = sniffCopyMime(body);
  const attachmentId = match.attachment?.id ?? item.attachmentId ?? item.key;

  if (item.column && mime) {
    const { col, rowId, orgId, value } = item.column;
    const path = buildCopyPath(orgId, rowId, mime);
    await storeBytes(col.bucket, path, body, mime);
    if (await setColumnValue(col, rowId, value, path)) {
      manifest.items[item.key] = { status: 'recovered', via: match.verdict, attachmentId, bucket: col.bucket, path, size: body.byteLength, contentType: mime };
      delete manifest.failed![item.key];
      return;
    }
  }

  // Unknown types are stored as opaque bytes so a signed URL never renders them inline.
  const contentType = mime ?? 'application/octet-stream';
  const path = recoveredPath(item, match);
  await storeBytes(ARCHIVE_BUCKET, path, body, contentType, true);
  const entry = { status: 'recovered' as const, via: match.verdict, attachmentId, bucket: ARCHIVE_BUCKET, path, size: body.byteLength, contentType };
  if (item.column) {
    // The column still points at Airtable: keep it listed as failed so the copy skips it.
    manifest.items[`recovered:${item.key}`] = entry;
  } else {
    manifest.items[item.key] = entry;
    delete manifest.failed![item.key];
  }
}

function addGroup(groups: Map<string, RecoverGroup>, item: FailedItem, verdict: FailedVerdict): void {
  const id = `${item.table}\u0000${item.field}\u0000${item.reason}\u0000${verdict}`;
  const group = groups.get(id) ?? { table: item.table, field: item.field, reason: item.reason, verdict, count: 0 };
  group.count++;
  groups.set(id, group);
}

/**
 * Processes up to `limit` failures whose key sorts after `after`.
 * `report` writes nothing; `recover` uploads, updates columns and the manifest.
 */
export async function runRecoverBatch({
  mode,
  limit,
  after,
}: {
  mode: RecoverMode;
  limit: number;
  after?: string | null;
}): Promise<RecoverSummary> {
  const manifest = await readManifest();
  manifest.failed ??= {};
  const total = Object.keys(manifest.failed).length;

  const all = await loadFailedItems(manifest.failed);
  const pending = all.filter((item) => !after || item.key > after);
  const batch = pending.slice(0, limit);
  const nextAfter = pending.length > batch.length ? batch[batch.length - 1].key : null;

  const fetcher = new AttachmentFetcher(readAirtableCredentials());
  const groups = new Map<string, RecoverGroup>();
  const errors: RecoverSummary['errors'] = [];
  let recovered = 0;
  let dirty = false;

  const byEnv = new Map<string, FailedItem[]>();
  for (const item of batch) byEnv.set(item.envKey, [...(byEnv.get(item.envKey) ?? []), item]);

  try {
    for (const [envKey, items] of byEnv) {
      let fresh: AttachmentsByRecord;
      try {
        const tableId = resolveTableId(envKey);
        if (!tableId) throw new CopyError('table_not_configured');
        fresh = await fetcher.fetchAttachments(tableId, [...new Set(items.map((i) => i.recordId))]);
      } catch (err) {
        const reason = err instanceof CopyError ? err.reason : err instanceof AirtableFetchError ? err.message : 'airtable_fetch_failed';
        for (const item of items) errors.push({ ref: item.key, reason });
        continue;
      }

      for (const item of items) {
        const match = await diagnose(item, fresh);
        addGroup(groups, item, match.verdict);
        if (mode !== 'recover' || !RECOVERABLE.has(match.verdict)) continue;
        try {
          await recoverOne(item, match, manifest);
          dirty = true;
          recovered++;
        } catch (err) {
          errors.push({ ref: item.key, reason: err instanceof CopyError ? err.reason : 'unknown' });
        }
      }
    }
  } finally {
    if (dirty) await writeManifest(manifest);
  }

  const summary: RecoverSummary = {
    total,
    processed: batch.length,
    recovered,
    nextAfter,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
    errors,
  };
  log.info('[airtable-final-recover] batch done', { mode, total, processed: batch.length, recovered, errors: errors.length });
  return summary;
}
