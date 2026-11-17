/**
 * Pure helpers for the one-off Airtable attachment copy: URL checks, content
 * sniffing, storage path building and snapshot attachment extraction.
 */

import { randomUUID } from 'crypto';
import { buildStoragePath, type AllowedMimeType } from '@/lib/storage';
import { sniffMimeType } from '@/lib/storage/mime-sniff';
import { ARCHIVE_PREFIX, SNAPSHOT_TABLE_ENV } from './fields';

export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export type CopyMime = AllowedMimeType | 'image/gif' | 'application/pdf';

const EXT_BY_MIME: Record<CopyMime, string> = {
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
  'image/gif':       'gif',
  'application/pdf': 'pdf',
};

const AIRTABLE_HOSTS = ['airtableusercontent.com', 'dl.airtable.com'] as const;

export function isAirtableUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol, hostname } = new URL(value);
    if (protocol !== 'https:') return false;
    return AIRTABLE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** Detects the real content type from magic bytes; null when not an allowed file. */
export function sniffCopyMime(buffer: Buffer): CopyMime | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return sniffMimeType(buffer) as CopyMime | null;
}

/** Same `{orgId}/{resourceId}/{uuid}.{ext}` shape as `buildStoragePath`, for any allowed type. */
export function buildCopyPath(orgId: string, resourceId: string, mime: CopyMime): string {
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') {
    return buildStoragePath(orgId, resourceId, mime);
  }
  return `${orgId}/${resourceId}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
}

export function sanitizeSegment(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '_')
    .replace(/^\.+/, '_')
    .trim()
    .slice(0, 150);
  return cleaned || 'file';
}

export interface SnapshotAttachment {
  table: string;
  recordId: string;
  field: string;
  attachmentId: string;
  filename: string;
  declaredType: string;
  /** Position inside the Airtable attachment field (0 = the one a DB column mirrors). */
  index: number;
  /** Unique, filesystem-safe name inside `<table>/<recordId>/<field>/`. */
  archiveName: string;
}

export function manifestKey(a: Pick<SnapshotAttachment, 'table' | 'recordId' | 'field' | 'attachmentId'>): string {
  return `${a.table}/${a.recordId}/${a.field}/${a.attachmentId}`;
}

export function archivePath(a: Pick<SnapshotAttachment, 'table' | 'recordId' | 'field' | 'archiveName'>): string {
  return `${ARCHIVE_PREFIX}/${a.table}/${a.recordId}/${sanitizeSegment(a.field)}/${a.archiveName}`;
}

function isAttachmentLike(item: unknown): item is { id: string; url: string; filename?: unknown; type?: unknown } {
  if (typeof item !== 'object' || item === null) return false;
  const o = item as Record<string, unknown>;
  return typeof o.id === 'string' && o.id !== '' && typeof o.url === 'string';
}

/** Attachments inside one snapshot row (`data.fields[*]` arrays of Airtable attachments). */
export function extractSnapshotAttachments(
  table: string,
  recordId: string,
  data: unknown,
): SnapshotAttachment[] {
  if (!(table in SNAPSHOT_TABLE_ENV)) return [];
  const fields = (data as { fields?: unknown } | null)?.fields;
  if (typeof fields !== 'object' || fields === null) return [];

  const out: SnapshotAttachment[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!Array.isArray(value)) continue;
    const items = value.filter(isAttachmentLike).filter((item) => isAirtableUrl(item.url));
    if (items.length === 0) continue;

    const usedNames = new Set<string>();
    value.forEach((item, index) => {
      if (!isAttachmentLike(item) || !isAirtableUrl(item.url)) return;
      const filename = typeof item.filename === 'string' ? item.filename : '';
      const safe = sanitizeSegment(filename || item.id);
      const archiveName = usedNames.has(safe) ? `${sanitizeSegment(item.id)}_${safe}` : safe;
      usedNames.add(safe);
      out.push({
        table,
        recordId,
        field,
        attachmentId: item.id,
        filename: filename || item.id,
        declaredType: typeof item.type === 'string' ? item.type : '',
        index,
        archiveName,
      });
    });
  }
  return out;
}
