/**
 * Storage abstraction layer — Cloudflare R2 via its S3-compatible API.
 *
 * Thin TypeScript module exposing:
 *   uploadImage()       — upload a buffer to a private bucket
 *   getSignedUrl()      — generate a time-limited presigned GET URL
 *   deleteImage()       — remove an object from storage
 *   validateImageFile() — check MIME + magic bytes + size before upload
 *   buildStoragePath()  — canonical path helper: {orgId}/{resourceId}/{uuid}.{ext}
 *
 * Security controls applied here:
 *   - ASVS V12.1.1  MIME allowlist enforced
 *   - ASVS V12.1.2  magic-byte sniff via sniffMimeType()
 *   - ASVS V12.1.3  size cap server-side (never trust client Content-Length)
 *   - ASVS V12.2.1  original filename is metadata only — storage path is uuid-based
 *   - ASVS V12.3.1  path traversal: path built from server-controlled template
 *   - ASVS V12.6.1  SVG rejected (not in ALLOWED_MIME_TYPES)
 *
 * Credential security:
 *   - R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY are SERVER-ONLY.
 *   - NEVER use NEXT_PUBLIC_ for any R2 credential.
 *   - Presigned URL TTL is capped at DEFAULT_SIGNED_URL_TTL_S (3600s).
 *
 * Bucket layout:
 *   One physical R2 bucket (R2_BUCKET, default 'propflow-files'). Callers keep
 *   passing the logical bucket name (e.g. 'receipts') and the DB-stored path;
 *   the object key is the stored path, as in the pre-R2 shared bucket (see objectKey).
 */

import { AwsClient } from 'aws4fetch';
import { sniffMimeType } from '@/lib/storage/mime-sniff';
import { createHash, randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed MIME types for image uploads — SVG intentionally excluded (ASVS V12.6.1) */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Default signed URL TTL in seconds (1 hour — hard cap) */
export const DEFAULT_SIGNED_URL_TTL_S = 3600;

/** Maximum image size in bytes (5 MB) */
export const MAX_IMAGE_SIZE_BYTES = 5_242_880;

/** Maximum images per unit (IC-11 quota) */
export const MAX_IMAGES_PER_UNIT = 20;

// ---------------------------------------------------------------------------
// Object key layout
// ---------------------------------------------------------------------------

/** Physical R2 bucket used when R2_BUCKET is not set */
const DEFAULT_R2_BUCKET = 'propflow-files';

/**
 * Object key inside the single physical bucket: the stored path itself. Production
 * storage (pre-R2) already kept every logical bucket in one bucket under these keys, so
 * the copy to R2 is 1:1 and stored paths stay valid.
 */
export function objectKey(_bucket: string, path: string): string {
  return path;
}

// ---------------------------------------------------------------------------
// S3 client (SigV4 over fetch — runs on Node and Cloudflare Workers)
// ---------------------------------------------------------------------------

/** Same retry budget the AWS SDK used by default (3 attempts) */
const S3_RETRIES = 2;

/** Upper bound for a single S3 request */
const S3_REQUEST_TIMEOUT_MS = 30_000;

interface S3Backend {
  client: AwsClient;
  endpoint: URL;
  bucket: string;
}

function buildS3Backend(): S3Backend {
  const endpoint        = process.env.R2_S3_ENDPOINT;
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      '[storage] Missing storage credentials. Set R2_S3_ENDPOINT + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY.'
    );
  }

  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, region: 'auto', service: 's3', retries: S3_RETRIES }),
    endpoint: new URL(endpoint),
    bucket: process.env.R2_BUCKET || DEFAULT_R2_BUCKET,
  };
}

// Lazy singleton — only instantiated when first storage call is made
let _s3: S3Backend | null = null;
function s3(): S3Backend {
  if (!_s3) _s3 = buildS3Backend();
  return _s3;
}

/** Path-style object URL: https://{account}.r2.cloudflarestorage.com/{bucket}/{path} */
function objectUrl(logicalBucket: string, path: string): URL {
  const { endpoint, bucket } = s3();
  const encodedKey = objectKey(logicalBucket, path).split('/').map(encodeURIComponent).join('/');
  return new URL(`${endpoint.origin}/${encodeURIComponent(bucket)}/${encodedKey}`);
}

async function s3Error(operation: string, res: Response): Promise<Error> {
  const body = await res.text().catch(() => '');
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  return new Error(`${operation} failed: HTTP ${res.status}${code ? ` ${code}` : ''}`);
}

async function s3PutObject(
  logicalBucket: string,
  path: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const { client } = s3();
  const bytes = new Uint8Array(body);
  const signed = await client.sign(objectUrl(logicalBucket, path).toString(), {
    method: 'PUT',
    body: bytes,
    headers: {
      'Content-Type': contentType,
      'X-Amz-Content-Sha256': createHash('sha256').update(body).digest('hex'),
    },
  });
  // Raw bytes, not the signed Request: Next's patched fetch re-streams a Request body, dropping Content-Length (S3/R2 then answers 411).
  const res = await fetch(signed.url, {
    method: 'PUT',
    headers: signed.headers,
    body: bytes,
    signal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw await s3Error('PutObject', res);
}

async function s3DeleteObject(logicalBucket: string, path: string): Promise<void> {
  const { client } = s3();
  const res = await client.fetch(objectUrl(logicalBucket, path), {
    method: 'DELETE',
    signal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw await s3Error('DeleteObject', res);
}

async function s3PresignGetObject(logicalBucket: string, path: string, expiresIn: number): Promise<string> {
  const { client } = s3();
  const url = objectUrl(logicalBucket, path);
  url.searchParams.set('X-Amz-Expires', String(expiresIn));
  const signed = await client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

// ---------------------------------------------------------------------------
// Path builder
// ---------------------------------------------------------------------------

/**
 * Builds the canonical storage path for an uploaded image.
 *
 * Format: {orgId}/{resourceId}/{uuid}.{ext}
 *
 * The uuid is generated server-side — the original filename is NEVER used
 * as a path segment (ASVS V12.2.1 + V12.3.1 path-traversal defense).
 *
 * @param orgId      Organization UUID
 * @param resourceId Resource UUID (e.g. unit_id, tenant_id)
 * @param mimeType   Validated MIME type (determines extension)
 * @returns          Storage path string
 */
export function buildStoragePath(
  orgId: string,
  resourceId: string,
  mimeType: AllowedMimeType
): string {
  const ext = mimeTypeToExt(mimeType);
  const uuid = randomUUID();
  return `${orgId}/${resourceId}/${uuid}.${ext}`;
}

/** Maps allowed MIME types to file extensions */
function mimeTypeToExt(mimeType: AllowedMimeType): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/webp': return 'webp';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sniffedMime?: string | null;
}

/**
 * Validates an image file buffer before upload.
 *
 * Checks:
 *   1. Declared MIME type is in the allowlist
 *   2. File size is within the limit
 *   3. Magic bytes match the declared MIME type (IC-12 anti-spoofing)
 *
 * @param buffer        Raw file bytes
 * @param declaredMime  MIME type declared by the client
 * @param maxBytes      Max allowed size in bytes (default: MAX_IMAGE_SIZE_BYTES = 5 MB)
 * @returns             Validation result with error message if invalid
 */
export function validateImageFile(
  buffer: Buffer,
  declaredMime: string,
  maxBytes: number = MAX_IMAGE_SIZE_BYTES
): ValidationResult {
  // 1. Allowlist check
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(declaredMime)) {
    return {
      valid: false,
      error: `MIME type "${declaredMime}" is not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
    };
  }

  // 2. Size check (server-side — ASVS V12.1.3)
  if (buffer.byteLength > maxBytes) {
    return {
      valid: false,
      error: `File size ${buffer.byteLength} bytes exceeds maximum of ${maxBytes} bytes`,
    };
  }

  // 3. Magic-byte sniff (ASVS V12.1.2 + IC-12)
  const sniffedMime = sniffMimeType(buffer);
  if (sniffedMime === null) {
    return {
      valid: false,
      error: 'Could not determine file type from content (unknown magic bytes)',
      sniffedMime: null,
    };
  }

  if (sniffedMime !== declaredMime) {
    return {
      valid: false,
      error: `Declared MIME type "${declaredMime}" does not match file content (detected: "${sniffedMime}")`,
      sniffedMime,
    };
  }

  return { valid: true, sniffedMime };
}

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

/**
 * Uploads an image buffer to R2 under the logical bucket prefix.
 *
 * The calling Server Action is responsible for auth checks
 * (requireAdmin / requireTenant) BEFORE calling this function.
 *
 * @param bucket    Logical bucket name (e.g. 'unit-images', 'tenant-avatars')
 * @param path      Storage path (e.g. '{orgId}/{unitId}/{uuid}.jpg')
 * @param buffer    File content as Buffer
 * @param mimeType  Validated MIME type for the Content-Type header
 * @returns         Object with { path } on success — throws on failure
 */
export async function uploadImage(
  bucket: string,
  path: string,
  buffer: Buffer,
  mimeType: AllowedMimeType
): Promise<{ path: string }> {

  try {
    await s3PutObject(bucket, path, buffer, mimeType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[storage.uploadImage] bucket=${bucket} path=${path} error=${msg}`);
  }

  return { path };
}

/**
 * Uploads arbitrary bytes to R2 (used for non-image files
 * such as PDF receipts and PNG signature images).
 *
 * @param bucket      Logical bucket name
 * @param path        Storage key / path
 * @param body        Raw bytes
 * @param contentType MIME type
 * @param _upsert     If false (default), the upload is a new object; if true, overwrites
 * @returns           Object with { path } on success — throws on failure
 */
export async function uploadFile(
  bucket: string,
  path: string,
  body: Buffer | ArrayBuffer | Uint8Array,
  contentType: string,
  _upsert: boolean = false,
): Promise<{ path: string }> {
  let buffer: Buffer;
  if (body instanceof Buffer) {
    buffer = body;
  } else if (body instanceof ArrayBuffer) {
    buffer = Buffer.from(new Uint8Array(body));
  } else {
    buffer = Buffer.from(body);
  }

  try {
    // S3 PutObject has no native "upsert=false" guard; if the caller wants
    // strict "no overwrite" semantics, they should check existence first.
    // The upsert param is kept for API compatibility with the legacy storage seam.
    await s3PutObject(bucket, path, buffer, contentType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[storage.uploadFile] bucket=${bucket} path=${path} error=${msg}`);
  }

  return { path };
}

/**
 * Generates a presigned GET URL for a private storage object.
 *
 * The caller is responsible for IDOR checks (path.startsWith(ctx.orgId)) before
 * calling this function. This function only generates the URL — it does not enforce
 * access control.
 *
 * @param bucket  Logical bucket name
 * @param path    Object path within the bucket
 * @param ttl     Presigned URL TTL in seconds (default: DEFAULT_SIGNED_URL_TTL_S = 3600, hard cap)
 * @returns       Presigned URL string — throws on failure
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  ttl: number = DEFAULT_SIGNED_URL_TTL_S
): Promise<string> {
  // Hard cap: never issue presigned URLs longer than 1 hour
  const safeTtl = Math.min(ttl, DEFAULT_SIGNED_URL_TTL_S);

  try {
    return await s3PresignGetObject(bucket, path, safeTtl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[storage.getSignedUrl] bucket=${bucket} path=${path} error=${msg}`);
  }
}

/**
 * Downloads a private storage object through a short-lived presigned URL.
 * The caller is responsible for the same IDOR checks as getSignedUrl.
 */
export async function downloadFile(bucket: string, path: string): Promise<Buffer> {
  const url = await getSignedUrl(bucket, path, 60);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`[storage.downloadFile] bucket=${bucket} path=${path} status=${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Deletes an object from R2.
 *
 * The calling Server Action is responsible for verifying ownership before
 * calling this function.
 *
 * @param bucket  Logical bucket name
 * @param path    Object path to delete
 * @throws        Error if deletion fails
 */
export async function deleteImage(
  bucket: string,
  path: string
): Promise<void> {

  try {
    await s3DeleteObject(bucket, path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[storage.deleteImage] bucket=${bucket} path=${path} error=${msg}`);
  }
}
