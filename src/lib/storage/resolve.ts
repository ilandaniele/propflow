import { getSignedUrl } from '@/lib/storage';

/**
 * Turns a DB-stored file reference into a URL a browser can open.
 *
 * Own uploads (and files copied out of Airtable) are stored as bucket paths and
 * get a short-lived signed URL. Legacy absolute URLs pass through untouched.
 * Returns null when there is nothing to show or signing fails.
 */
export async function resolveStoredFileUrl(bucket: string, value: string | null): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return await getSignedUrl(bucket, value);
  } catch {
    return null;
  }
}
