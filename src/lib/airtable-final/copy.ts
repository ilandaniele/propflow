/**
 * One-off copy of Airtable attachments into our own storage.
 *
 * Phase 1: every column in ATTACHMENT_COLUMNS holding an Airtable URL is replaced
 *          by a storage path (`{orgId}/{rowId}/{uuid}.{ext}` in the column's bucket).
 * Phase 2: once every pending column row has been attempted, every attachment found in airtable_snapshots
 *          is archived (or becomes a unit_images row), unless that attachment id was
 *          already copied. State lives in airtable-archive/manifest.json.
 *
 * Stored URLs are expired, so a fresh attachment URL is always fetched from the
 * Airtable API first. Failures are reported by short reason codes; URLs and
 * secrets are never logged or returned.
 */

import { uploadFile } from '@/lib/storage';
import { log } from '@/lib/log';
import {
  archivePath,
  buildCopyPath,
  extractSnapshotAttachments,
  isAirtableUrl,
  manifestKey,
  type CopyMime,
  type SnapshotAttachment,
} from './attachments';
import {
  AttachmentFetcher,
  readAirtableCredentials,
  resolveTableId,
  type AirtableAttachment,
  type AttachmentsByRecord,
} from './airtable';
import { CopyError, downloadAttachment, type DownloadedFile } from './download';
import {
  ARCHIVE_BUCKET,
  ATTACHMENT_COLUMNS,
  SNAPSHOT_TABLE_ENV,
  UNIT_IMAGES_BUCKET,
  UNIT_SNAPSHOT_TABLE,
  type AttachmentColumn,
} from './fields';
import { readManifest, writeManifest, type Manifest, type ManifestEntry } from './manifest';
import {
  countPendingColumnRows,
  findUnitIds,
  insertUnitImage,
  listPendingColumnRows,
  listSnapshotRows,
  setColumnValue,
} from './store';

export type CopyMode = 'dry-run' | 'apply';

export interface CopySummary {
  copied: number;
  skipped: number;
  failed: number;
  remaining: number;
  /** Attachments that can never be copied (recorded in the manifest, excluded from `remaining`). */
  permanentFailures: number;
  errors: Array<{ ref: string; reason: string }>;
}

interface RunContext {
  apply: boolean;
  summary: CopySummary;
  manifest: Manifest;
  failed: Record<string, string>;
  copiedAttachmentIds: Set<string>;
  fetcher: AttachmentFetcher;
  manifestDirty: boolean;
}

type SnapshotItem = SnapshotAttachment & { orgId: string };

const UNIT_IMAGE_MIMES: readonly CopyMime[] = ['image/jpeg', 'image/png', 'image/webp'];
const PERMANENT_REASONS = new Set(['record_not_found', 'attachment_not_found', 'unsupported_type', 'too_large']);

const columnRef = (col: AttachmentColumn, rowId: string) => `${col.dbTable}.${col.dbColumn}#${rowId}`;
const snapshotRef = (item: SnapshotAttachment) => `snapshot.${item.table}.${item.field}#${item.recordId}`;
const columnManifestKey = (col: AttachmentColumn, rowId: string) => `column:${columnRef(col, rowId)}`;

function fail(ctx: RunContext, ref: string, err: unknown, key?: string): void {
  const reason = err instanceof CopyError ? err.reason : err instanceof Error ? err.message.slice(0, 60) : 'unknown';
  ctx.summary.failed++;
  ctx.summary.errors.push({ ref, reason });
  if (ctx.apply && key && PERMANENT_REASONS.has(reason)) {
    ctx.failed[key] = reason;
    ctx.manifestDirty = true;
  }
}

function failedColumnRowIds(ctx: RunContext, col: AttachmentColumn): string[] {
  const prefix = columnManifestKey(col, '');
  return Object.keys(ctx.failed).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
}

function record(ctx: RunContext, key: string, entry: ManifestEntry): void {
  ctx.manifest.items[key] = entry;
  ctx.copiedAttachmentIds.add(entry.attachmentId);
  ctx.manifestDirty = true;
}

async function fetchFresh(
  ctx: RunContext,
  envKey: string,
  recordIds: string[],
  fields?: string[],
): Promise<AttachmentsByRecord> {
  const tableId = resolveTableId(envKey);
  if (!tableId) throw new CopyError('table_not_configured');
  try {
    return await ctx.fetcher.fetchAttachments(tableId, recordIds, fields);
  } catch (err) {
    throw new CopyError(err instanceof Error && err.message.startsWith('airtable_http_') ? err.message : 'airtable_fetch_failed');
  }
}

function uploadFailureReason(err: unknown): string {
  const storageError = err instanceof Error ? /error=(.+)$/.exec(err.message)?.[1] : undefined;
  return storageError ? `upload_failed: ${storageError.slice(0, 80)}` : 'upload_failed';
}

async function store(bucket: string, path: string, file: DownloadedFile, upsert = false): Promise<void> {
  try {
    await uploadFile(bucket, path, file.body, file.contentType, upsert);
  } catch (err) {
    throw new CopyError(uploadFailureReason(err));
  }
}

// ---------------------------------------------------------------------------
// Phase 1: DB columns
// ---------------------------------------------------------------------------

async function copyColumn(ctx: RunContext, col: AttachmentColumn, budget: number): Promise<number> {
  const rows = await listPendingColumnRows(col, budget, failedColumnRowIds(ctx, col));
  const candidates = rows.filter((row) => {
    if (isAirtableUrl(row.value)) return true;
    ctx.summary.skipped++;
    return false;
  });
  if (candidates.length === 0) return rows.length;

  let fresh: AttachmentsByRecord;
  try {
    fresh = await fetchFresh(ctx, col.airtableTable, [...new Set(candidates.map((r) => r.recordId))], [col.airtableField]);
  } catch (err) {
    for (const row of candidates) fail(ctx, columnRef(col, row.id), err);
    return rows.length;
  }

  for (const row of candidates) {
    const ref = columnRef(col, row.id);
    try {
      const fields = fresh.get(row.recordId);
      if (!fields) throw new CopyError('record_not_found');
      const attachment: AirtableAttachment | undefined = fields[col.airtableField]?.[0];
      if (!attachment) throw new CopyError('attachment_not_found');

      const file = await downloadAttachment(attachment.url);
      if (ctx.apply) {
        const path = buildCopyPath(row.orgId, row.id, file.contentType);
        await store(col.bucket, path, file);
        if (!(await setColumnValue(col, row.id, row.value, path))) throw new CopyError('row_changed');
        record(ctx, columnManifestKey(col, row.id), {
          status: 'column',
          attachmentId: attachment.id,
          bucket: col.bucket,
          path,
          size: file.body.byteLength,
          contentType: file.contentType,
        });
      }
      ctx.summary.copied++;
    } catch (err) {
      fail(ctx, ref, err, columnManifestKey(col, row.id));
    }
  }
  return rows.length;
}

async function countPendingColumns(ctx: RunContext): Promise<number> {
  const counts = await Promise.all(ATTACHMENT_COLUMNS.map((col) => countPendingColumnRows(col, failedColumnRowIds(ctx, col))));
  return counts.reduce((sum, n) => sum + n, 0);
}

// ---------------------------------------------------------------------------
// Phase 2: airtable_snapshots
// ---------------------------------------------------------------------------

async function loadSnapshotItems(): Promise<SnapshotItem[]> {
  const rows = await listSnapshotRows();
  return rows.flatMap((row) =>
    extractSnapshotAttachments(row.table, row.recordId, row.data).map((a) => ({ ...a, orgId: row.orgId })),
  );
}

const pendingSnapshotItems = (items: SnapshotItem[], ctx: RunContext) =>
  items.filter((item) => !(manifestKey(item) in ctx.manifest.items) && !(manifestKey(item) in ctx.failed));

async function copySnapshotBatch(ctx: RunContext, batch: SnapshotItem[]): Promise<void> {
  const unitIdsByOrg = await loadUnitIds(batch);

  const byTable = new Map<string, SnapshotItem[]>();
  for (const item of batch) byTable.set(item.table, [...(byTable.get(item.table) ?? []), item]);

  for (const [table, items] of byTable) {
    let fresh: AttachmentsByRecord;
    try {
      fresh = await fetchFresh(ctx, SNAPSHOT_TABLE_ENV[table], [...new Set(items.map((i) => i.recordId))]);
    } catch (err) {
      for (const item of items) fail(ctx, snapshotRef(item), err);
      continue;
    }
    for (const item of items) await copySnapshotItem(ctx, item, fresh, unitIdsByOrg);
  }
}

async function loadUnitIds(batch: SnapshotItem[]): Promise<Map<string, Map<string, string>>> {
  const idsByOrg = new Map<string, Set<string>>();
  for (const item of batch.filter((i) => i.table === UNIT_SNAPSHOT_TABLE)) {
    idsByOrg.set(item.orgId, (idsByOrg.get(item.orgId) ?? new Set()).add(item.recordId));
  }
  const result = new Map<string, Map<string, string>>();
  for (const [orgId, ids] of idsByOrg) result.set(orgId, await findUnitIds(orgId, [...ids]));
  return result;
}

async function copySnapshotItem(
  ctx: RunContext,
  item: SnapshotItem,
  fresh: AttachmentsByRecord,
  unitIdsByOrg: Map<string, Map<string, string>>,
): Promise<void> {
  const key = manifestKey(item);
  try {
    if (ctx.copiedAttachmentIds.has(item.attachmentId)) {
      if (ctx.apply) record(ctx, key, { status: 'duplicate', attachmentId: item.attachmentId });
      ctx.summary.skipped++;
      return;
    }

    const fields = fresh.get(item.recordId);
    if (!fields) throw new CopyError('record_not_found');
    const attachment = fields[item.field]?.find((a) => a.id === item.attachmentId);
    if (!attachment) throw new CopyError('attachment_not_found');

    const file = await downloadAttachment(attachment.url);
    if (ctx.apply) {
      const unitId = unitIdsByOrg.get(item.orgId)?.get(item.recordId);
      const asUnitImage = item.table === UNIT_SNAPSHOT_TABLE && unitId && UNIT_IMAGE_MIMES.includes(file.contentType);
      if (asUnitImage) {
        const path = buildCopyPath(item.orgId, unitId, file.contentType);
        await store(UNIT_IMAGES_BUCKET, path, file);
        await insertUnitImage({
          orgId: item.orgId,
          unitId,
          storagePath: path,
          filename: item.filename,
          mimeType: file.contentType,
          sizeBytes: file.body.byteLength,
        });
        record(ctx, key, { status: 'unit_image', attachmentId: item.attachmentId, bucket: UNIT_IMAGES_BUCKET, path, size: file.body.byteLength, contentType: file.contentType });
      } else {
        const path = archivePath(item);
        await store(ARCHIVE_BUCKET, path, file, true);
        record(ctx, key, { status: 'archived', attachmentId: item.attachmentId, bucket: ARCHIVE_BUCKET, path, size: file.body.byteLength, contentType: file.contentType });
      }
    }
    ctx.summary.copied++;
  } catch (err) {
    fail(ctx, snapshotRef(item), err, key);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Processes up to `limit` pending attachments. `dry-run` fetches and validates
 * them (counting what would be copied) but writes nothing: no upload, no DB
 * update, no manifest.
 */
export async function runCopyBatch({ mode, limit }: { mode: CopyMode; limit: number }): Promise<CopySummary> {
  const manifest = await readManifest();
  const ctx: RunContext = {
    apply: mode === 'apply',
    summary: { copied: 0, skipped: 0, failed: 0, remaining: 0, permanentFailures: 0, errors: [] },
    manifest,
    failed: (manifest.failed ??= {}),
    copiedAttachmentIds: new Set(),
    fetcher: new AttachmentFetcher(readAirtableCredentials()),
    manifestDirty: false,
  };
  for (const entry of Object.values(ctx.manifest.items)) ctx.copiedAttachmentIds.add(entry.attachmentId);

  let snapshotItems: SnapshotItem[] = [];
  try {
    let budget = limit;
    for (const col of ATTACHMENT_COLUMNS) {
      if (budget <= 0) break;
      budget -= await copyColumn(ctx, col, budget);
    }

    snapshotItems = await loadSnapshotItems();
    // Budget left over means every pending column row was attempted this batch,
    // so attachment ids already copied by a column are known to the dedupe set.
    if (budget > 0) {
      await copySnapshotBatch(ctx, pendingSnapshotItems(snapshotItems, ctx).slice(0, budget));
    }
  } finally {
    if (ctx.apply && ctx.manifestDirty) await writeManifest(ctx.manifest);
  }

  ctx.summary.remaining = (await countPendingColumns(ctx)) + pendingSnapshotItems(snapshotItems, ctx).length;
  ctx.summary.permanentFailures = Object.keys(ctx.failed).length;
  log.info('[airtable-final-copy] batch done', {
    mode,
    copied: ctx.summary.copied,
    skipped: ctx.summary.skipped,
    failed: ctx.summary.failed,
    remaining: ctx.summary.remaining,
    permanentFailures: ctx.summary.permanentFailures,
  });
  return ctx.summary;
}
