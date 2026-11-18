import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

const ENV_KEYS = ['R2_S3_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;

const ORIGIN = 'https://acct123.r2.cloudflarestorage.com';

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo, init?: RequestInit) => Promise<Response>>>;

async function loadStorage() {
  vi.resetModules();
  return import('@/lib/storage/index');
}

function lastRequest(fetchMock: FetchMock): Request {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return new Request(input, init);
}

describe('storage R2 client (aws4fetch, S3 API)', () => {
  let fetchMock: FetchMock;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.R2_S3_ENDPOINT = ORIGIN;
    process.env.R2_ACCESS_KEY_ID = 'AKIATESTKEY';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET = 'propflow-bucket';

    fetchMock = vi.fn<(input: RequestInfo, init?: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('uploadImage / uploadFile', () => {
    it('PUTs a signed request to the path-style R2 URL, key prefixed with the logical bucket', async () => {
      const { uploadImage } = await loadStorage();
      const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const result = await uploadImage('unit-images', 'org1/unit1/a b.jpg', body, 'image/jpeg');

      expect(result).toEqual({ path: 'org1/unit1/a b.jpg' });
      const request = lastRequest(fetchMock);
      expect(request.method).toBe('PUT');
      expect(request.url).toBe(`${ORIGIN}/propflow-bucket/unit-images/org1/unit1/a%20b.jpg`);
      expect(request.headers.get('content-type')).toBe('image/jpeg');
      expect(request.headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(body).digest('hex'));
      expect(request.headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIATESTKEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/,
      );
    });

    it('passes the body to fetch as raw bytes so Content-Length is kept', async () => {
      const { uploadFile } = await loadStorage();
      const body = Buffer.from([1, 2, 3]);

      await uploadFile('receipts', 'org/r.pdf', body, 'application/pdf');

      const [input, init] = fetchMock.mock.calls.at(-1)!;
      expect(input).not.toBeInstanceOf(Request);
      expect(init?.body).toBeInstanceOf(Uint8Array);
      expect(init?.body).toEqual(new Uint8Array(body));
    });

    it('defaults the physical bucket to propflow-files when R2_BUCKET is unset', async () => {
      delete process.env.R2_BUCKET;
      const { uploadFile } = await loadStorage();

      const result = await uploadFile('receipts', 'org/r.pdf', new Uint8Array([1, 2, 3]), 'application/pdf');

      expect(result).toEqual({ path: 'org/r.pdf' });
      expect(lastRequest(fetchMock).url).toBe(`${ORIGIN}/propflow-files/receipts/org/r.pdf`);
    });

    it('wraps a non-2xx response with the S3 error code', async () => {
      fetchMock.mockResolvedValue(
        new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
      );
      const { uploadFile } = await loadStorage();

      await expect(uploadFile('contracts', 'o/c.pdf', Buffer.from('x'), 'application/pdf')).rejects.toThrow(
        '[storage.uploadFile] bucket=contracts path=o/c.pdf error=PutObject failed: HTTP 403 AccessDenied',
      );
    });
  });

  describe('objectKey', () => {
    it('prefixes the stored path with the logical bucket', async () => {
      const { objectKey } = await loadStorage();

      expect(objectKey('receipts', 'org/r.pdf')).toBe('receipts/org/r.pdf');
    });
  });

  describe('getSignedUrl', () => {
    it('returns a query-signed GET URL with the requested expiry', async () => {
      const { getSignedUrl } = await loadStorage();

      const url = new URL(await getSignedUrl('unit-images', 'org/unit/x.jpg', 600));

      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe('/propflow-bucket/unit-images/org/unit/x.jpg');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^AKIATESTKEY\/\d{8}\/auto\/s3\/aws4_request$/);
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('defaults to and hard-caps the TTL at 3600 seconds', async () => {
      const { getSignedUrl, DEFAULT_SIGNED_URL_TTL_S } = await loadStorage();

      const defaulted = new URL(await getSignedUrl('unit-images', 'a/b.jpg'));
      const capped = new URL(await getSignedUrl('unit-images', 'a/b.jpg', 86_400));

      expect(defaulted.searchParams.get('X-Amz-Expires')).toBe(String(DEFAULT_SIGNED_URL_TTL_S));
      expect(capped.searchParams.get('X-Amz-Expires')).toBe('3600');
      expect(capped.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('throws a storage error when credentials are missing', async () => {
      delete process.env.R2_SECRET_ACCESS_KEY;
      const { getSignedUrl } = await loadStorage();

      await expect(getSignedUrl('unit-images', 'a/b.jpg')).rejects.toThrow('Missing storage credentials');
    });
  });

  describe('deleteImage', () => {
    it('sends a signed DELETE', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      const { deleteImage } = await loadStorage();

      await deleteImage('unit-images', 'org/unit/x.jpg');

      const request = lastRequest(fetchMock);
      expect(request.method).toBe('DELETE');
      expect(request.url).toBe(`${ORIGIN}/propflow-bucket/unit-images/org/unit/x.jpg`);
      expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
    });

    it('throws when the delete fails', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 403 }));
      const { deleteImage } = await loadStorage();

      await expect(deleteImage('unit-images', 'org/unit/x.jpg')).rejects.toThrow(
        '[storage.deleteImage] bucket=unit-images path=org/unit/x.jpg error=DeleteObject failed: HTTP 403',
      );
    });
  });
});
