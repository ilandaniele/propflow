/**
 * Storage abstraction layer — Tigris S3-compatible backend.
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
 *   - TIGRIS_ACCESS_KEY_ID, TIGRIS_SECRET_ACCESS_KEY are SERVER-ONLY.
 *   - NEVER use NEXT_PUBLIC_ for any Tigris credential.
 *   - Presigned URL TTL is capped at DEFAULT_SIGNED_URL_TTL_S (3600s).
 *
 * Bucket mapping:
 *   Old Supabase bucket names are mapped to Tigris bucket names via
 *   environment variables (TIGRIS_BUCKET_*). The public API is unchanged;
 *   callers pass the logical bucket name (e.g. 'receipts') and this module
 *   resolves the physical Tigris bucket.
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
// Bucket name resolution
// ---------------------------------------------------------------------------

/**
 * Maps logical (Supabase-era) bucket names to Tigris bucket names via env vars.
 *
 * Callers pass the logical name — this function resolves the physical bucket.
 * Each logical bucket has a dedicated env var; if not set we fall back to the
 * logical name so that local dev with a single catch-all bucket still works.
 *
 * Logical → env var mapping:
 *   unit-images       → TIGRIS_BUCKET_UNIT_IMAGES
 *   tenant-avatars    → TIGRIS_BUCKET_TENANT_AVATARS
 *   receipts          → TIGRIS_BUCKET_RECEIPTS
 *   incident-photos   → TIGRIS_BUCKET_INCIDENT_PHOTOS
 *   task-proofs       → TIGRIS_BUCKET_TASK_PROOFS
 *   contracts         → TIGRIS_BUCKET_CONTRACTS
 */
const BUCKET_ENV_MAP: Record<string, string> = {
  'unit-images':     'TIGRIS_BUCKET_UNIT_IMAGES',
  'tenant-avatars':  'TIGRIS_BUCKET_TENANT_AVATARS',
  'receipts':        'TIGRIS_BUCKET_RECEIPTS',
  'incident-photos': 'TIGRIS_BUCKET_INCIDENT_PHOTOS',
  'task-proofs':     'TIGRIS_BUCKET_TASK_PROOFS',
  'contracts':       'TIGRIS_BUCKET_CONTRACTS',
};

function resolveBucket(logicalName: string): string {
  // 1. Per-bucket TIGRIS_BUCKET_* env var (highest priority)
  const envKey = BUCKET_ENV_MAP[logicalName];
  if (envKey) {
    const envVal = process.env[envKey];
    if (envVal) return envVal;
  }
  // 2. Single STORAGE_BUCKET env var (Fly.io existing deployment uses one bucket for all objects)
  const storageBucket = process.env.STORAGE_BUCKET;
  if (storageBucket) return storageBucket;
  // 3. Fall back to logical name (local dev with a single catch-all bucket)
  return logicalName;
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
}

function buildS3Backend(): S3Backend {
  // Accept both TIGRIS_* (new) and STORAGE_* (existing Fly deployment) env var names
  const endpoint      = process.env.TIGRIS_ENDPOINT      ?? process.env.STORAGE_ENDPOINT;
  const region        = process.env.AWS_REGION            ?? process.env.STORAGE_REGION ?? 'auto';
  const accessKeyId   = process.env.TIGRIS_ACCESS_KEY_ID  ?? process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TIGRIS_SECRET_ACCESS_KEY ?? process.env.STORAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      '[storage] Missing storage credentials. Set STORAGE_ENDPOINT + STORAGE_ACCESS_KEY_ID + STORAGE_SECRET_ACCESS_KEY (or TIGRIS_* equivalents).'
    );
  }

  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3', retries: S3_RETRIES }),
    endpoint: new URL(endpoint),
  };
}

// Lazy singleton — only instantiated when first storage call is made
let _s3: S3Backend | null = null;
function s3(): S3Backend {
  if (!_s3) _s3 = buildS3Backend();
  return _s3;
}

/** Virtual-hosted-style object URL: https://{bucket}.{endpoint-host}/{key} */
function objectUrl(bucket: string, key: string): URL {
  const { endpoint } = s3();
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return new URL(`${endpoint.protocol}//${bucket}.${endpoint.host}/${encodedKey}`);
}

async function s3Error(operation: string, res: Response): Promise<Error> {
  const body = await res.text().catch(() => '');
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  return new Error(`${operation} failed: HTTP ${res.status}${code ? ` ${code}` : ''}`);
}

async function s3PutObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const { client } = s3();
  const bytes = new Uint8Array(body);
  const signed = await client.sign(objectUrl(bucket, key).toString(), {
    method: 'PUT',
    body: bytes,
    headers: {
      'Content-Type': contentType,
      'X-Amz-Content-Sha256': createHash('sha256').update(body).digest('hex'),
    },
  });
  // Raw bytes, not the signed Request: Next's patched fetch re-streams a Request body, dropping Content-Length (S3 then answers 411).
  const res = await fetch(signed.url, {
    method: 'PUT',
    headers: signed.headers,
    body: bytes,
    signal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw await s3Error('PutObject', res);
}

async function s3DeleteObject(bucket: string, key: string): Promise<void> {
  const { client } = s3();
  const res = await client.fetch(objectUrl(bucket, key), {
    method: 'DELETE',
    signal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw await s3Error('DeleteObject', res);
}

async function s3PresignGetObject(bucket: string, key: string, expiresIn: number): Promise<string> {
  const { client } = s3();
  const url = objectUrl(bucket, key);
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
 * Uploads an image buffer to a Tigris S3 bucket.
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
  const physicalBucket = resolveBucket(bucket);

  try {
    await s3PutObject(physicalBucket, path, buffer, mimeType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[storage.uploadImage] bucket=${bucket} path=${path} error=${msg}`);
  }

  return { path };
}

/**
 * Uploads arbitrary bytes to a Tigris S3 bucket (used for non-image files
 * such as PDF receipts and PNG signature images).
 *
 * @param bucket      Logical bucket name
 * @param path        Storage key / path
 * @param body        Raw bytes
 * @param contentType MIME type
 * @param upsert      If false (default), the upload is a new object; if true, overwrites
 * @returns           Object with { path } on success — throws on failure
 */
export async function uploadFile(
  bucket: string,
  path: string,
  body: Buffer | ArrayBuffer | Uint8Array,
  contentType: string,
  upsert: boolean = false,
): Promise<{ path: string }> {
  const physicalBucket = resolveBucket(bucket);
  let buffer: Buffer;
  if (body instanceof Buffer) {
    buffer = body;
  } else if (body instanceof ArrayBuffer) {
    buffer = Buffer.from(new Uint8Array(body));
  } else {
    buffer = Buffer.from(body);
  }

  try {
    // Tigris does not have a native "upsert=false" guard; if the caller wants
    // strict "no overwrite" semantics, they should check existence first.
    // The upsert param is kept for API compatibility with the legacy storage seam.
    await s3PutObject(physicalBucket, path, buffer, contentType);
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
  const physicalBucket = resolveBucket(bucket);

  try {
    return await s3PresignGetObject(physicalBucket, path, safeTtl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[storage.getSignedUrl] bucket=${bucket} path=${path} error=${msg}`);
  }
}

/**
 * Deletes an object from a Tigris S3 bucket.
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
  const physicalBucket = resolveBucket(bucket);

  try {
    await s3DeleteObject(physicalBucket, path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[storage.deleteImage] bucket=${bucket} path=${path} error=${msg}`);
  }
}
