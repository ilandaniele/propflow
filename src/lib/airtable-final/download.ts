import { isAirtableUrl, MAX_DOWNLOAD_BYTES, sniffCopyMime, type CopyMime } from './attachments';

const DOWNLOAD_TIMEOUT_MS = 60_000;

export class CopyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'CopyError';
  }
}

export interface DownloadedFile {
  body: Buffer;
  contentType: CopyMime;
}

/**
 * Downloads a (fresh) Airtable attachment URL. Only Airtable hosts, no redirects,
 * hard size cap while streaming, content type taken from the bytes (not the header).
 * Errors carry a short reason code only — never the URL.
 */
export async function downloadAttachment(url: string): Promise<DownloadedFile> {
  const body = await downloadBytes(url);
  const contentType = sniffCopyMime(body);
  if (!contentType) throw new CopyError('unsupported_type');
  return { body, contentType };
}

/**
 * Same checks as `downloadAttachment` (Airtable hosts only, no redirects, size cap)
 * but any file type: the bytes are returned as they are, for archiving.
 */
export async function downloadBytes(url: string): Promise<Buffer> {
  if (!isAirtableUrl(url)) throw new CopyError('url_host_not_allowed');

  let res: Response;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new CopyError('download_failed');
  }
  if (!res.ok) throw new CopyError(`download_http_${res.status}`);

  const declaredLength = Number(res.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_DOWNLOAD_BYTES) throw new CopyError('too_large');

  return readCapped(res);
}

/** True when an Airtable URL still serves the file. Reads one byte at most. */
export async function isUrlAlive(url: string): Promise<boolean> {
  if (!isAirtableUrl(url)) return false;
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => undefined);
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) throw new CopyError('download_failed');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new CopyError('too_large');
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof CopyError) throw err;
    throw new CopyError('download_failed');
  }
  return Buffer.concat(chunks);
}
