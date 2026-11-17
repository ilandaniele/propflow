import { getSignedUrl, uploadFile } from '@/lib/storage';
import { ARCHIVE_BUCKET, MANIFEST_PATH } from './fields';

export type ManifestStatus = 'column' | 'archived' | 'unit_image' | 'duplicate' | 'recovered';

export interface ManifestEntry {
  status: ManifestStatus;
  attachmentId: string;
  bucket?: string;
  path?: string;
  size?: number;
  contentType?: string;
  /** For `recovered`: how the file was found again (a `FailedVerdict` from recover.ts). */
  via?: string;
}

export interface Manifest {
  version: 1;
  updatedAt: string;
  items: Record<string, ManifestEntry>;
  /** Manifest key -> reason, for attachments that can never be copied. Skipped by later batches. */
  failed?: Record<string, string>;
}

const READ_TIMEOUT_MS = 30_000;

export const emptyManifest = (): Manifest => ({ version: 1, updatedAt: new Date(0).toISOString(), items: {} });

export async function readManifest(): Promise<Manifest> {
  const url = await getSignedUrl(ARCHIVE_BUCKET, MANIFEST_PATH, 60);
  const res = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  if (res.status === 404) return emptyManifest();
  if (!res.ok) throw new Error(`manifest_read_http_${res.status}`);
  const parsed = (await res.json()) as Partial<Manifest>;
  return {
    version: 1,
    updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    items: parsed.items ?? {},
    failed: parsed.failed ?? {},
  };
}

export async function writeManifest(manifest: Manifest): Promise<void> {
  const body = Buffer.from(JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }, null, 2));
  await uploadFile(ARCHIVE_BUCKET, MANIFEST_PATH, body, 'application/json', true);
}
