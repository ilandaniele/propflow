import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

const ENV_KEYS = [
  'TIGRIS_ENDPOINT',
  'STORAGE_ENDPOINT',
  'TIGRIS_ACCESS_KEY_ID',
  'STORAGE_ACCESS_KEY_ID',
  'TIGRIS_SECRET_ACCESS_KEY',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_BUCKET',
  'TIGRIS_BUCKET_RECEIPTS',
] as const;

type FetchMock = ReturnType<typeof vi.fn<(request: Request) => Promise<Response>>>;

async function loadStorage() {
  vi.resetModules();
  return import('@/lib/storage/index');
}

function lastRequest(fetchMock: FetchMock): Request {
  const [request] = fetchMock.mock.calls.at(-1)!;
  return request;
}

describe('storage S3 client (aws4fetch)', () => {
  let fetchMock: FetchMock;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.TIGRIS_ENDPOINT = 'https://fly.storage.tigris.dev';
    process.env.TIGRIS_ACCESS_KEY_ID = 'AKIATESTKEY';
    process.env.TIGRIS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.STORAGE_BUCKET = 'propflow-bucket';

    fetchMock = vi.fn<(request: Request) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 200 }));
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
    it('PUTs a signed request to the virtual-hosted bucket URL', async () => {
      const { uploadImage } = await loadStorage();
      const body = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const result = await uploadImage('unit-images', 'org1/unit1/a b.jpg', body, 'image/jpeg');

      expect(result).toEqual({ path: 'org1/unit1/a b.jpg' });
      const request = lastRequest(fetchMock);
      expect(request.method).toBe('PUT');
      expect(request.url).toBe('https://propflow-bucket.fly.storage.tigris.dev/org1/unit1/a%20b.jpg');
      expect(request.headers.get('content-type')).toBe('image/jpeg');
      expect(request.headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(body).digest('hex'));
      expect(request.headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIATESTKEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/,
      );
    });

    it('resolves the per-bucket env var before STORAGE_BUCKET', async () => {
      process.env.TIGRIS_BUCKET_RECEIPTS = 'receipts-bucket';
      const { uploadFile } = await loadStorage();

      await uploadFile('receipts', 'org/r.pdf', new Uint8Array([1, 2, 3]), 'application/pdf');

      expect(lastRequest(fetchMock).url).toBe('https://receipts-bucket.fly.storage.tigris.dev/org/r.pdf');
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

  describe('getSignedUrl', () => {
    it('returns a query-signed GET URL with the requested expiry', async () => {
      const { getSignedUrl } = await loadStorage();

      const url = new URL(await getSignedUrl('unit-images', 'org/unit/x.jpg', 600));

      expect(url.origin).toBe('https://propflow-bucket.fly.storage.tigris.dev');
      expect(url.pathname).toBe('/org/unit/x.jpg');
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
    });

    it('throws a storage error when credentials are missing', async () => {
      delete process.env.TIGRIS_SECRET_ACCESS_KEY;
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
      expect(request.url).toBe('https://propflow-bucket.fly.storage.tigris.dev/org/unit/x.jpg');
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
