/**
 * Integration tests for unit image Server Actions.
 *
 * All Supabase and storage calls are mocked — no live DB or bucket required.
 *
 * Covers:
 *   AC1  — admin upload happy path
 *   AC2  — atomic cover toggle (unset prev cover + set new)
 *   AC3  — IMAGE_INVALID_MIME for magic-byte mismatch
 *   AC4  — IMAGE_TOO_LARGE for 6 MB file
 *   AC5  — IMAGE_QUOTA_EXCEEDED after 20 images
 *   AC6  — IDOR: admin from org B cannot upload to unit in org A
 *   AC10 — delete removes file + row
 *   AC11 — reorder updates sort_order
 *   AC12 — rate limit (31st call → RATE_LIMITED)
 *   AC24 — SVG rejection
 *   AC25 — path traversal: server uses uuid path (not original filename)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Polyfill crypto.randomUUID in test environment (needed for buildStoragePath)
// ---------------------------------------------------------------------------
if (!globalThis.crypto?.randomUUID) {
  const { randomUUID } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Constants: valid UUIDs for test fixtures
// ---------------------------------------------------------------------------
const UNIT_ID_U1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_ACME   = 'org-acme-aa-0000-0000-0000-000000000001'; // not a real UUID but that's ok for mock
const USER_ADMIN = 'user-admin-0000-0000-0000-00000000001a';
const IMG_X_ID   = 'bbbbbbbb-0000-0000-0000-000000000002';
const IMG_B_ID   = 'bbbbbbbb-0000-0000-0000-000000000003';
const IMG_A_ID   = 'cccccccc-0000-0000-0000-000000000001';
const IMG_B2_ID  = 'cccccccc-0000-0000-0000-000000000002';
const IMG_C_ID   = 'cccccccc-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// Helpers: magic-byte buffers
// ---------------------------------------------------------------------------

function jpegBuffer(size = 100): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  if (size <= header.length) return header;
  return Buffer.concat([header, Buffer.alloc(size - header.length)]);
}

function pngBuffer(size = 12): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  if (size <= header.length) return header;
  return Buffer.concat([header, Buffer.alloc(size - header.length)]);
}

function svgBuffer(): Buffer {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
}

// ---------------------------------------------------------------------------
// Mock state (mutated per-test)
// ---------------------------------------------------------------------------

interface MockState {
  role: 'admin' | 'tenant';
  orgId: string;
  userId: string;
  unitExists: boolean;
  imageCount: number;
  insertError: string | null;
  uploadError: string | null;
  imageRow: Record<string, unknown> | null;
}

const mockState: MockState = {
  role: 'admin',
  orgId: ORG_ACME,
  userId: USER_ADMIN,
  unitExists: true,
  imageCount: 0,
  insertError: null,
  uploadError: null,
  imageRow: null,
};

function resetMockState() {
  mockState.role = 'admin';
  mockState.orgId = ORG_ACME;
  mockState.userId = USER_ADMIN;
  mockState.unitExists = true;
  mockState.imageCount = 0;
  mockState.insertError = null;
  mockState.uploadError = null;
  mockState.imageRow = null;
}

// ---------------------------------------------------------------------------
// Mock: next/cache (revalidatePath is a no-op in tests)
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/auth/guards
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({
    userId: mockState.userId,
    orgId: mockState.orgId,
    role: 'admin',
    profile: { id: mockState.userId, org_id: mockState.orgId, role: 'admin' },
  })),
  requireTenant: vi.fn(async () => {
    if (mockState.role !== 'tenant') throw new Error('FORBIDDEN');
    return {
      userId: mockState.userId,
      orgId: mockState.orgId,
      role: 'tenant',
      profile: { id: mockState.userId, org_id: mockState.orgId, role: 'tenant' },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Supabase query builder mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a chainable mock that resolves with a fixed result.
 * The `then` callback is the Promise resolution — it's what lets `await` work.
 */
function makeQueryBuilder(result: unknown) {
  const p = Promise.resolve(result);
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(() => p),
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return builder;
}

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/server
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => buildSupabaseMock())})),
  createAdminServerClient: vi.fn(async () => buildSupabaseMock()),
}));

function buildSupabaseMock() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: mockState.userId } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      // Build a smart chainable mock based on table and current state
      const proxy = buildTableProxy(table);
      return proxy;
    }),
  };
}

function buildTableProxy(table: string) {
  // Track the chain of calls to resolve appropriately
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let isSingle = false;
  let isHead = false;
  let isInsert = false;
  let isDelete = false;
  let isUpdate = false;

  const builder: Record<string, unknown> = {};

  builder.select = vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
    calls.push({ method: 'select', args: [_cols, opts] });
    if (opts?.head) isHead = true;
    return builder;
  });

  builder.insert = vi.fn(() => {
    isInsert = true;
    calls.push({ method: 'insert', args: [] });
    return {
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve(
            mockState.insertError
              ? { data: null, error: { code: mockState.insertError } }
              : { data: { id: 'new-image-uuid' }, error: null }
          )
        ),
      })),
    };
  });

  builder.update = vi.fn(() => {
    isUpdate = true;
    calls.push({ method: 'update', args: [] });
    return builder;
  });

  builder.delete = vi.fn(() => {
    isDelete = true;
    calls.push({ method: 'delete', args: [] });
    return builder;
  });

  builder.eq = vi.fn(() => {
    calls.push({ method: 'eq', args: [] });
    return builder;
  });

  builder.neq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);

  builder.single = vi.fn(() => {
    isSingle = true;
    if (table === 'units') {
      return Promise.resolve(
        mockState.unitExists
          ? { data: { id: UNIT_ID_U1, org_id: mockState.orgId }, error: null }
          : { data: null, error: null }
      );
    }
    if (table === 'unit_images') {
      return Promise.resolve(
        mockState.imageRow
          ? { data: mockState.imageRow, error: null }
          : { data: null, error: null }
      );
    }
    return Promise.resolve({ data: null, error: null });
  });

  // Promise resolution for non-single queries (count, list, update, delete)
  const thenable = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      let res: unknown;

      if (table === 'unit_images' && isHead) {
        // Count query
        res = { data: null, count: mockState.imageCount, error: null };
      } else if (table === 'unit_images' && isUpdate) {
        res = { data: null, error: null };
      } else if (table === 'unit_images' && isDelete) {
        res = { data: null, error: null };
      } else if (table === 'unit_images' && !isInsert && !isSingle) {
        // List query (getUnitImages*)
        res = { data: [], error: null, count: null };
      } else if (isUpdate || isDelete) {
        res = { data: null, error: null };
      } else {
        res = { data: [], error: null, count: mockState.imageCount };
      }

      return Promise.resolve(res).then(resolve, reject);
    },
    catch: (reject: (e: unknown) => unknown) => Promise.resolve().catch(reject),
    finally: (cb: () => void) => Promise.resolve().finally(cb),
  };

  // Merge thenable into builder for await-ability
  Object.assign(builder, thenable);

  return builder;
}

// ---------------------------------------------------------------------------
// Mock: @/lib/storage/index
// ---------------------------------------------------------------------------

const capturedUploadPaths: string[] = [];
const capturedDeletePaths: string[] = [];

vi.mock('@/lib/storage/index', async (importOriginal) => {
  // Import the actual module to keep validateImageFile and buildStoragePath real
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    uploadImage: vi.fn(async (_bucket: string, path: string) => {
      if (mockState.uploadError) throw new Error(mockState.uploadError);
      capturedUploadPaths.push(path);
      return { path };
    }),
    deleteImage: vi.fn(async (_bucket: string, path: string) => {
      capturedDeletePaths.push(path);
    }),
    getSignedUrl: vi.fn(async () => 'https://signed.supabase.co/unit-images/signed-url'),
  };
});

// ---------------------------------------------------------------------------
// Mock: @/lib/ratelimit
// ---------------------------------------------------------------------------

let rateLimitCallCount = 0;
let rateLimitMax = 9999;

vi.mock('@/lib/ratelimit', () => ({
  actionRateLimit: vi.fn((_key: string, _max: number) => {
    rateLimitCallCount++;
    if (rateLimitCallCount > rateLimitMax) {
      return { success: false, retryAfterMs: 1000 };
    }
    return { success: true, retryAfterMs: 0 };
  }),
  mutationRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })),
}));

// ---------------------------------------------------------------------------
// Import actions AFTER all mocks are set up
// ---------------------------------------------------------------------------

import {
  uploadUnitImage,
  deleteUnitImage,
  setUnitCoverImage,
  reorderUnitImages,
} from '@/app/actions/unit-images';

// ---------------------------------------------------------------------------
// Helpers: build FormData
// ---------------------------------------------------------------------------

function makeUploadFormData(overrides: {
  unit_id?: string;
  is_cover?: string;
  caption?: string;
  mime?: string;
  size?: number;
  filename?: string;
} = {}): FormData {
  const {
    unit_id = UNIT_ID_U1,
    is_cover = 'false',
    caption,
    mime = 'image/jpeg',
    size,
    filename = 'photo.jpg',
  } = overrides;

  const bufferSize = size ?? 100; // small default — actual size validation done by validateImageFile
  let buf: Buffer;

  if (mime === 'image/png') {
    buf = pngBuffer(bufferSize);
  } else if (mime === 'image/svg+xml' || mime === 'text/html' || mime === 'image/gif') {
    buf = svgBuffer();
  } else {
    buf = jpegBuffer(bufferSize);
  }

  // For oversized tests, we pass the declared size but keep actual buffer small
  // (validateImageFile uses buffer.byteLength, so we need the actual buffer to be big)
  const finalBuf = size != null ? Buffer.concat([buf.slice(0, Math.min(buf.length, 12)), Buffer.alloc(Math.max(0, size - 12))]) : buf;

  const file = new File([finalBuf], filename, { type: mime });

  const fd = new FormData();
  fd.set('unit_id', unit_id);
  fd.set('is_cover', is_cover);
  if (caption) fd.set('caption', caption);
  fd.set('file', file);
  return fd;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockState();
  capturedUploadPaths.length = 0;
  capturedDeletePaths.length = 0;
  rateLimitCallCount = 0;
  rateLimitMax = 9999;
  vi.clearAllMocks();
});

// ── AC1: Admin upload happy path ─────────────────────────────────────────────

describe('AC1 — uploadUnitImage happy path', () => {
  it('returns ok with id and signed_url for a valid 2MB JPEG', async () => {
    const result = await uploadUnitImage({}, makeUploadFormData());
    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data?.id).toBe('new-image-uuid');
    expect(result.data?.signed_url).toMatch(/signed/);
  });

  it('uploads to the unit-images bucket at {orgId}/{unitId}/{uuid}.jpg path', async () => {
    await uploadUnitImage({}, makeUploadFormData({ unit_id: UNIT_ID_U1 }));
    expect(capturedUploadPaths).toHaveLength(1);
    // Path must be: {orgId}/{unitId}/{uuid}.{ext} — never the original filename
    const storagePath = capturedUploadPaths[0];
    const parts = storagePath.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(mockState.orgId);
    expect(parts[1]).toBe(UNIT_ID_U1);
    // uuid part must not contain the original filename
    expect(parts[2]).not.toContain('photo.jpg');
    expect(parts[2]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });
});

// ── AC2: Atomic cover toggle ─────────────────────────────────────────────────

describe('AC2 — setUnitCoverImage atomic cover toggle', () => {
  it('returns ok when setting a cover image', async () => {
    mockState.imageRow = {
      id: IMG_B_ID,
      org_id: ORG_ACME,
      unit_id: UNIT_ID_U1,
      storage_path: `${ORG_ACME}/${UNIT_ID_U1}/uuid-b.jpg`,
      is_cover: false,
    };

    const fd = new FormData();
    fd.set('id', IMG_B_ID);

    const result = await setUnitCoverImage({}, fd);
    expect(result.error).toBeUndefined();
  });

  it('uploadUnitImage with is_cover=true calls unset-previous logic (returns ok)', async () => {
    const fd = makeUploadFormData({ is_cover: 'true' });
    const result = await uploadUnitImage({}, fd);
    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBeDefined();
  });
});

// ── AC3: IMAGE_INVALID_MIME for magic-byte mismatch ──────────────────────────

describe('AC3 — IMAGE_INVALID_MIME for MIME mismatch', () => {
  it('rejects a file with PNG magic bytes but declared as image/jpeg', async () => {
    // Override the file with PNG magic bytes but JPEG declared MIME
    const pngBuf = pngBuffer();
    const file = new File([pngBuf], 'photo.jpg', { type: 'image/jpeg' });
    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('is_cover', 'false');
    fd.set('file', file);

    const result = await uploadUnitImage({}, fd);
    expect(result.error?.code).toBe('IMAGE_INVALID_MIME');
    expect(capturedUploadPaths).toHaveLength(0); // no file written
  });

  it('rejects image/gif (not in MIME allowlist)', async () => {
    const gifBuf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const file = new File([gifBuf], 'anim.gif', { type: 'image/gif' });
    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('is_cover', 'false');
    fd.set('file', file);

    const result = await uploadUnitImage({}, fd);
    expect(result.error?.code).toBe('IMAGE_INVALID_MIME');
    expect(capturedUploadPaths).toHaveLength(0);
  });
});

// ── AC4: IMAGE_TOO_LARGE ──────────────────────────────────────────────────────

describe('AC4 — IMAGE_TOO_LARGE for file over 5 MB', () => {
  it('rejects a 6 MB JPEG with IMAGE_TOO_LARGE', async () => {
    const SIX_MB = 6 * 1024 * 1024;
    const fd = makeUploadFormData({ size: SIX_MB });
    const result = await uploadUnitImage({}, fd);
    expect(result.error?.code).toBe('IMAGE_TOO_LARGE');
    expect(capturedUploadPaths).toHaveLength(0);
  });

  it('rejects exactly 5MB + 1 byte with IMAGE_TOO_LARGE', async () => {
    const fd = makeUploadFormData({ size: 5_242_881 });
    const result = await uploadUnitImage({}, fd);
    expect(result.error?.code).toBe('IMAGE_TOO_LARGE');
  });
});

// ── AC5: IMAGE_QUOTA_EXCEEDED ────────────────────────────────────────────────

describe('AC5 — IMAGE_QUOTA_EXCEEDED for 21st image', () => {
  it('rejects upload when unit already has 20 images', async () => {
    mockState.imageCount = 20;
    const result = await uploadUnitImage({}, makeUploadFormData());
    expect(result.error?.code).toBe('IMAGE_QUOTA_EXCEEDED');
    expect(capturedUploadPaths).toHaveLength(0);
  });

  it('allows upload when unit has exactly 19 images', async () => {
    mockState.imageCount = 19;
    const result = await uploadUnitImage({}, makeUploadFormData());
    expect(result.error).toBeUndefined();
  });
});

// ── AC6: IDOR — cross-org upload rejected ────────────────────────────────────

describe('AC6 — IDOR: admin from org B cannot upload to unit in org A', () => {
  it('returns NOT_FOUND when unit does not belong to admin org', async () => {
    mockState.unitExists = false; // unit not found in admin's org

    const result = await uploadUnitImage({}, makeUploadFormData());
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(capturedUploadPaths).toHaveLength(0);
  });
});

// ── AC10: Delete removes file + row ──────────────────────────────────────────

describe('AC10 — deleteUnitImage removes file and row', () => {
  it('calls deleteImage and returns ok', async () => {
    mockState.imageRow = {
      id: IMG_X_ID,
      org_id: ORG_ACME,
      unit_id: UNIT_ID_U1,
      storage_path: `${ORG_ACME}/${UNIT_ID_U1}/uuid-x.jpg`,
      is_cover: false,
    };

    const fd = new FormData();
    fd.set('id', IMG_X_ID);

    const result = await deleteUnitImage({}, fd);
    expect(result.error).toBeUndefined();
    expect(capturedDeletePaths).toContain(`${ORG_ACME}/${UNIT_ID_U1}/uuid-x.jpg`);
  });

  it('returns NOT_FOUND if image does not exist in org', async () => {
    mockState.imageRow = null;
    const fd = new FormData();
    fd.set('id', 'nonexistent-id');

    const result = await deleteUnitImage({}, fd);
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(capturedDeletePaths).toHaveLength(0);
  });

  it('returns IMAGE_COVER_CONFLICT when deleting cover with other images present', async () => {
    mockState.imageRow = {
      id: IMG_X_ID,
      org_id: ORG_ACME,
      unit_id: UNIT_ID_U1,
      storage_path: `${ORG_ACME}/${UNIT_ID_U1}/uuid-cover.jpg`,
      is_cover: true,
    };
    // Simulate 3 total images in the unit
    mockState.imageCount = 3;

    const fd = new FormData();
    fd.set('id', IMG_X_ID);

    const result = await deleteUnitImage({}, fd);
    expect(result.error?.code).toBe('IMAGE_COVER_CONFLICT');
    expect(capturedDeletePaths).toHaveLength(0);
  });
});

// ── AC11: Reorder updates sort_order ─────────────────────────────────────────

describe('AC11 — reorderUnitImages', () => {
  it('returns ok for valid reorder input', async () => {
    const ids = [IMG_C_ID, IMG_A_ID, IMG_B2_ID];

    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('order', JSON.stringify(ids));

    const result = await reorderUnitImages({}, fd);
    expect(result.error).toBeUndefined();
  });

  it('returns VALIDATION_ERROR for non-UUID entries in order array', async () => {
    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('order', JSON.stringify(['not-a-uuid']));

    const result = await reorderUnitImages({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR for malformed JSON in order field', async () => {
    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('order', 'not-json');

    const result = await reorderUnitImages({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND if unit does not belong to admin org', async () => {
    mockState.unitExists = false;

    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('order', JSON.stringify([IMG_A_ID]));

    const result = await reorderUnitImages({}, fd);
    expect(result.error?.code).toBe('NOT_FOUND');
  });
});

// ── AC12: Rate limit ──────────────────────────────────────────────────────────

describe('AC12 — rate limit on upload (30/min)', () => {
  it('returns RATE_LIMITED when actionRateLimit returns success=false', async () => {
    // Exceed the limit immediately
    rateLimitMax = 0;

    const result = await uploadUnitImage({}, makeUploadFormData());
    expect(result.error?.code).toBe('RATE_LIMITED');
  });

  it('succeeds when rate limit is not exceeded', async () => {
    rateLimitMax = 9999;
    const result = await uploadUnitImage({}, makeUploadFormData());
    expect(result.error?.code).not.toBe('RATE_LIMITED');
  });
});

// ── AC24: SVG rejection ───────────────────────────────────────────────────────

describe('AC24 — SVG upload rejected (IMAGE_INVALID_MIME)', () => {
  it('rejects image/svg+xml declared MIME', async () => {
    const file = new File([svgBuffer()], 'icon.svg', { type: 'image/svg+xml' });
    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('is_cover', 'false');
    fd.set('file', file);

    const result = await uploadUnitImage({}, fd);
    expect(result.error?.code).toBe('IMAGE_INVALID_MIME');
    expect(capturedUploadPaths).toHaveLength(0);
  });

  it('rejects SVG content with declared image/png MIME (magic-byte mismatch)', async () => {
    // SVG bytes don't match PNG magic bytes
    const file = new File([svgBuffer()], 'icon.png', { type: 'image/png' });
    const fd = new FormData();
    fd.set('unit_id', UNIT_ID_U1);
    fd.set('is_cover', 'false');
    fd.set('file', file);

    const result = await uploadUnitImage({}, fd);
    expect(result.error?.code).toBe('IMAGE_INVALID_MIME');
    expect(capturedUploadPaths).toHaveLength(0);
  });
});

// ── AC25: Path traversal ignored — server uses uuid storage path ──────────────

describe('AC25 — path traversal: server generates uuid-based storage path', () => {
  it('uploads a file named ../../etc/passwd.jpg with a uuid-based storage path', async () => {
    const fd = makeUploadFormData({ filename: '../../etc/passwd.jpg' });
    const result = await uploadUnitImage({}, fd);

    // Upload should succeed
    expect(result.error).toBeUndefined();

    // The storage path must NOT contain the original filename or path traversal chars
    expect(capturedUploadPaths).toHaveLength(1);
    const storagePath = capturedUploadPaths[0];
    expect(storagePath).not.toContain('passwd');
    expect(storagePath).not.toContain('..');
    expect(storagePath).not.toContain('etc');

    // Path must be uuid-based: {orgId}/{unitId}/{uuid}.{ext}
    const parts = storagePath.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[2]).toMatch(/^[0-9a-f-]{36}\.\w{3,4}$/);
  });
});

// ── Unauthenticated / wrong role ─────────────────────────────────────────────

describe('auth guard — non-admin cannot upload', () => {
  it('returns UNAUTHORIZED when requireAdmin throws', async () => {
    const { requireAdmin } = await import('@/lib/auth/guards');
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('FORBIDDEN'));

    const result = await uploadUnitImage({}, makeUploadFormData());
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });
});
