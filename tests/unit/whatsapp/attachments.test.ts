/**
 * Unit tests for whatsapp/attachments.ts
 * downloadAndStoreAttachment now uses Tigris S3 via @/lib/storage — no Supabase client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Mock @/lib/storage ───────────────────────────────────────────────────────

vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn().mockResolvedValue({ path: 'mocked-path' }),
}));

import { downloadAndStoreAttachment } from '@/lib/whatsapp/attachments';

function makeOkResponse(bytes: Uint8Array, contentType = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    headers: { get: vi.fn().mockReturnValue(contentType) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('downloadAndStoreAttachment', () => {
  it('downloads image and uploads to Tigris storage, returns correct fields', async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    mockFetch.mockResolvedValue(makeOkResponse(imageBytes, 'image/jpeg'));

    const result = await downloadAndStoreAttachment(
      'https://cdn.example.com/img.jpg',
      'org-1',
      'receipts',
      'orgs/org-1/receipts/img.jpg'
    );

    expect(result.storagePath).toBe('orgs/org-1/receipts/img.jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.sha256).toHaveLength(64); // SHA-256 hex is 64 chars
    expect(result.imageBytes).toBeInstanceOf(Buffer);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cdn.example.com/img.jpg',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('uses image/jpeg as default when content-type header is absent', async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(imageBytes.buffer),
      headers: { get: vi.fn().mockReturnValue(null) },
    });

    const result = await downloadAndStoreAttachment(
      'https://example.com/img', 'org-1', 'receipts', 'orgs/org-1/img'
    );
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('throws when fetch returns non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    await expect(
      downloadAndStoreAttachment('https://example.com/img', 'org-1', 'receipts', 'path')
    ).rejects.toThrow('HTTP 403');
  });

  it('throws when storage upload fails', async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValue(makeOkResponse(imageBytes));

    const { uploadFile } = await import('@/lib/storage');
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('bucket not found'));

    await expect(
      downloadAndStoreAttachment('https://example.com/img', 'org-1', 'receipts', 'path')
    ).rejects.toThrow('Storage upload failed');
  });

  it('sha256 digest is deterministic for same content', async () => {
    const imageBytes = new Uint8Array([10, 20, 30, 40]);
    mockFetch.mockResolvedValue(makeOkResponse(imageBytes));
    const result1 = await downloadAndStoreAttachment(
      'https://example.com/img', 'org-1', 'receipts', 'path'
    );

    mockFetch.mockResolvedValue(makeOkResponse(imageBytes));
    const result2 = await downloadAndStoreAttachment(
      'https://example.com/img', 'org-1', 'receipts', 'path'
    );

    expect(result1.sha256).toBe(result2.sha256);
  });

  it('png mime type is preserved from content-type header', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
    mockFetch.mockResolvedValue(makeOkResponse(imageBytes, 'image/png'));

    const result = await downloadAndStoreAttachment(
      'https://example.com/img.png', 'org-1', 'task-proofs', 'orgs/org-1/proof.png'
    );
    expect(result.mimeType).toBe('image/png');
  });
});
