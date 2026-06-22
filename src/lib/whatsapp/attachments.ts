/**
 * Attachment downloader and storer.
 * In production, the real provider's downloadAttachment() fetches from Meta/Twilio CDN.
 * MockProvider returns the storagePath as-is (no real download).
 *
 * This module handles the Tigris S3 storage upload side.
 * Migrated from Supabase storage to Tigris S3 (W6).
 */

import { uploadFile } from '@/lib/storage';
import { log } from '@/lib/log';
import { sha256Hex } from './dedupe';

export interface StoreAttachmentResult {
  storagePath: string;
  imageBytes: Buffer;
  sha256: string;
  mimeType: string;
}

/**
 * Download a URL (from a signed storage URL or provider URL) and upload to Tigris S3.
 * Returns { storagePath, imageBytes, sha256, mimeType }.
 */
export async function downloadAndStoreAttachment(
  sourceUrl: string,
  orgId: string,
  bucket: string,
  storagePath: string
): Promise<StoreAttachmentResult> {
  // Fetch the image from the source URL
  const imageRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
  if (!imageRes.ok) {
    throw new Error(`Failed to fetch attachment: HTTP ${imageRes.status}`);
  }

  const buf = Buffer.from(await imageRes.arrayBuffer());
  const sha256 = sha256Hex(buf);
  const mimeType = imageRes.headers.get('content-type') ?? 'image/jpeg';

  // Upload to Tigris S3 via storage lib
  try {
    await uploadFile(bucket, storagePath, buf, mimeType, false);
  } catch (err) {
    log.error('[attachments] storage upload failed', {
      bucket,
      storagePath,
      error: (err as Error).message,
    });
    throw new Error('Storage upload failed');
  }

  return { storagePath, imageBytes: buf, sha256, mimeType };
}
