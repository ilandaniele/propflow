/**
 * Integration tests for tenant self-service avatar actions.
 *
 * All Supabase and storage calls are mocked — no live DB or bucket required.
 *
 * Covers:
 *   AC13 — Tenant uploads own avatar: photo_url updated, storage upload called
 *   AC14 — IDOR guard: tenant whose userId maps to no row → FORBIDDEN (403)
 *   AC13 — deleteOwnTenantAvatar: clears photo_url + calls deleteImage
 *   AC13 — Oversized file → IMAGE_TOO_LARGE
 *   AC13 — Invalid MIME → IMAGE_INVALID_MIME
 *   AC13 — Rate limit (6th call within window → RATE_LIMITED)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Polyfill crypto.randomUUID in test environment
// ---------------------------------------------------------------------------
if (!globalThis.crypto?.randomUUID) {
  const { randomUUID } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Test fixtures (UUIDs)
// ---------------------------------------------------------------------------

const ORG_ACME   = 'org-acme-aa-0000-0000-0000-000000000001';
const USER_T1    = 'user-tenant1-000-0000-0000-000000000001';
const USER_T2    = 'user-tenant2-000-0000-0000-000000000002';
const TENANT_ID  = 'tenant-row-00-0000-0000-000000000001';
const OLD_PATH   = `${ORG_ACME}/${TENANT_ID}/old-uuid.png`;

// ---------------------------------------------------------------------------
// Magic-byte helpers
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

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

interface MockState {
  role: 'admin' | 'tenant';
  userId: string;
  orgId: string;
  /** Tenant row returned by the tenants lookup; null = no row found (IDOR test) */
  tenantRow: { id: string; photo_url: string | null } | null;
  uploadError: string | null;
  dbUpdateError: string | null;
}

const mockState: MockState = {
  role: 'tenant',
  userId: USER_T1,
  orgId: ORG_ACME,
  tenantRow: { id: TENANT_ID, photo_url: null },
  uploadError: null,
  dbUpdateError: null,
};

function resetMockState() {
  mockState.role = 'tenant';
  mockState.userId = USER_T1;
  mockState.orgId = ORG_ACME;
  mockState.tenantRow = { id: TENANT_ID, photo_url: null };
  mockState.uploadError = null;
  mockState.dbUpdateError = null;
}

// ---------------------------------------------------------------------------
// Mock: next/cache
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/auth/guards
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (mockState.role !== 'admin') throw new Error('FORBIDDEN');
    return {
      userId: mockState.userId,
      orgId: mockState.orgId,
      role: 'admin',
      profile: { id: mockState.userId, org_id: mockState.orgId, role: 'admin' },
    };
  }),
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
// Mock: @/lib/supabase/server
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => buildSupabaseMock()),
}));

function buildSupabaseMock() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: mockState.userId } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => buildTableProxy(table)),
  };
}

function buildTableProxy(table: string) {
  let isUpdate = false;

  const builder: Record<string, unknown> = {};

  builder.select = vi.fn(() => builder);
  builder.update = vi.fn(() => { isUpdate = true; return builder; });
  builder.delete = vi.fn(() => builder);
  builder.eq    = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);

  builder.single = vi.fn(() => {
    if (table === 'tenants') {
      if (mockState.tenantRow === null) {
        return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
      }
      if (isUpdate) {
        return Promise.resolve(
          mockState.dbUpdateError
            ? { data: null, error: { code: mockState.dbUpdateError } }
            : { data: mockState.tenantRow, error: null }
        );
      }
      return Promise.resolve({ data: mockState.tenantRow, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  // Make builder thenable (for awaited queries without .single())
  const thenableFn = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let res: unknown;
    if (table === 'tenants' && isUpdate) {
      res = mockState.dbUpdateError
        ? { data: null, error: { code: mockState.dbUpdateError } }
        : { data: null, error: null };
    } else {
      res = { data: null, error: null };
    }
    return Promise.resolve(res).then(resolve, reject);
  };

  builder.then = thenableFn;
  builder.catch = (rej: (e: unknown) => unknown) => Promise.resolve().catch(rej);
  builder.finally = (cb: () => void) => Promise.resolve().finally(cb);

  return builder;
}

// ---------------------------------------------------------------------------
// Mock: @/lib/storage/index (keep validateImageFile + buildStoragePath real)
// ---------------------------------------------------------------------------

const capturedUploadCalls: Array<{ bucket: string; path: string }> = [];
const capturedDeleteCalls: Array<{ bucket: string; path: string }> = [];

vi.mock('@/lib/storage/index', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    uploadImage: vi.fn(async (bucket: string, path: string) => {
      if (mockState.uploadError) throw new Error(mockState.uploadError);
      capturedUploadCalls.push({ bucket, path });
      return { path };
    }),
    deleteImage: vi.fn(async (bucket: string, path: string) => {
      capturedDeleteCalls.push({ bucket, path });
    }),
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
// Import actions AFTER mocks are set up
// ---------------------------------------------------------------------------

import { updateOwnTenantAvatar, deleteOwnTenantAvatar } from '@/app/actions/tenants';

// ---------------------------------------------------------------------------
// FormData helpers
// ---------------------------------------------------------------------------

function makeAvatarFormData(opts: {
  mime?: string;
  size?: number;
} = {}): FormData {
  const { mime = 'image/jpeg', size } = opts;

  let buf: Buffer;
  if (mime === 'image/png') {
    buf = pngBuffer(size ?? 100);
  } else {
    buf = jpegBuffer(size ?? 100);
  }

  // For oversized test: build a buffer with real headers but padded to size
  const actualBuf = size != null
    ? Buffer.concat([buf.slice(0, Math.min(buf.length, 12)), Buffer.alloc(Math.max(0, size - 12))])
    : buf;

  const file = new File([actualBuf], 'avatar.jpg', { type: mime });
  const fd = new FormData();
  fd.set('file', file);
  return fd;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockState();
  capturedUploadCalls.length = 0;
  capturedDeleteCalls.length = 0;
  rateLimitCallCount = 0;
  rateLimitMax = 9999;
  vi.clearAllMocks();
});

// ── AC13: Tenant uploads own avatar (happy path) ─────────────────────────────

describe('AC13 — updateOwnTenantAvatar happy path', () => {
  it('returns ok for a valid 1 MB JPEG upload', async () => {
    const result = await updateOwnTenantAvatar({}, makeAvatarFormData());
    expect(result.error).toBeUndefined();
    expect(result.data).toBeUndefined(); // ok(undefined)
  });

  it('calls uploadImage on the tenant-avatars bucket', async () => {
    await updateOwnTenantAvatar({}, makeAvatarFormData());
    expect(capturedUploadCalls).toHaveLength(1);
    expect(capturedUploadCalls[0].bucket).toBe('tenant-avatars');
  });

  it('stores the path under {orgId}/{tenantId}/{uuid}.{ext}', async () => {
    await updateOwnTenantAvatar({}, makeAvatarFormData({ mime: 'image/png' }));
    expect(capturedUploadCalls).toHaveLength(1);
    const parts = capturedUploadCalls[0].path.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(ORG_ACME);
    expect(parts[1]).toBe(TENANT_ID);
    expect(parts[2]).toMatch(/^[0-9a-f-]{36}\.png$/);
  });

  it('deletes old avatar from storage when photo_url already exists', async () => {
    mockState.tenantRow = { id: TENANT_ID, photo_url: OLD_PATH };
    await updateOwnTenantAvatar({}, makeAvatarFormData());
    expect(capturedDeleteCalls).toHaveLength(1);
    expect(capturedDeleteCalls[0].bucket).toBe('tenant-avatars');
    expect(capturedDeleteCalls[0].path).toBe(OLD_PATH);
  });

  it('still succeeds even if old avatar delete throws', async () => {
    const { deleteImage } = await import('@/lib/storage/index');
    vi.mocked(deleteImage).mockRejectedValueOnce(new Error('storage 404'));
    mockState.tenantRow = { id: TENANT_ID, photo_url: OLD_PATH };
    const result = await updateOwnTenantAvatar({}, makeAvatarFormData());
    expect(result.error).toBeUndefined();
    // New upload still happened
    expect(capturedUploadCalls).toHaveLength(1);
  });

  it('revalidates /portal/profile and /portal on success', async () => {
    const { revalidatePath } = await import('next/cache');
    await updateOwnTenantAvatar({}, makeAvatarFormData());
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/portal/profile');
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/portal');
  });
});

// ── AC14: IDOR — tenant cannot upload avatar to another tenant's row ──────────

describe('AC14 — IDOR guard: no tenant row for userId → FORBIDDEN', () => {
  it('returns FORBIDDEN when userId does not match any tenant row', async () => {
    // Simulate USER_T2 calling the action — no tenant row exists for their profile
    mockState.userId = USER_T2;
    mockState.tenantRow = null; // DB returns no row for this userId

    const result = await updateOwnTenantAvatar({}, makeAvatarFormData());
    expect(result.error?.code).toBe('FORBIDDEN');
  });

  it('does not call uploadImage when IDOR guard triggers', async () => {
    mockState.userId = USER_T2;
    mockState.tenantRow = null;

    await updateOwnTenantAvatar({}, makeAvatarFormData());
    expect(capturedUploadCalls).toHaveLength(0);
  });

  it('deleteOwnTenantAvatar returns FORBIDDEN when no tenant row found', async () => {
    mockState.userId = USER_T2;
    mockState.tenantRow = null;

    const result = await deleteOwnTenantAvatar({});
    expect(result.error?.code).toBe('FORBIDDEN');
  });
});

// ── AC13: deleteOwnTenantAvatar ───────────────────────────────────────────────

describe('AC13 — deleteOwnTenantAvatar', () => {
  it('returns ok when tenant has an existing avatar', async () => {
    mockState.tenantRow = { id: TENANT_ID, photo_url: OLD_PATH };
    const result = await deleteOwnTenantAvatar({});
    expect(result.error).toBeUndefined();
  });

  it('calls deleteImage with correct bucket and path', async () => {
    mockState.tenantRow = { id: TENANT_ID, photo_url: OLD_PATH };
    await deleteOwnTenantAvatar({});
    expect(capturedDeleteCalls).toHaveLength(1);
    expect(capturedDeleteCalls[0].bucket).toBe('tenant-avatars');
    expect(capturedDeleteCalls[0].path).toBe(OLD_PATH);
  });

  it('returns ok when tenant has no existing avatar (no storage delete)', async () => {
    mockState.tenantRow = { id: TENANT_ID, photo_url: null };
    const result = await deleteOwnTenantAvatar({});
    expect(result.error).toBeUndefined();
    expect(capturedDeleteCalls).toHaveLength(0);
  });

  it('revalidates /portal/profile on success', async () => {
    const { revalidatePath } = await import('next/cache');
    mockState.tenantRow = { id: TENANT_ID, photo_url: OLD_PATH };
    await deleteOwnTenantAvatar({});
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/portal/profile');
  });

  it('correctly extracts path from a signed URL stored in photo_url', async () => {
    const signedUrl = `https://abcd.supabase.co/storage/v1/object/sign/tenant-avatars/${OLD_PATH}?token=xyz`;
    mockState.tenantRow = { id: TENANT_ID, photo_url: signedUrl };
    await deleteOwnTenantAvatar({});
    expect(capturedDeleteCalls[0].path).toBe(OLD_PATH);
  });
});

// ── Validation: oversized file → IMAGE_TOO_LARGE ─────────────────────────────

describe('File validation errors', () => {
  it('returns IMAGE_TOO_LARGE for a 6 MB file', async () => {
    const SIX_MB = 6 * 1024 * 1024;
    const result = await updateOwnTenantAvatar({}, makeAvatarFormData({ size: SIX_MB }));
    expect(result.error?.code).toBe('IMAGE_TOO_LARGE');
    expect(capturedUploadCalls).toHaveLength(0);
  });

  it('returns IMAGE_INVALID_MIME when declared MIME mismatches magic bytes', async () => {
    // Declare image/jpeg but pass a PNG buffer
    const pngBuf = pngBuffer(100);
    const file = new File([pngBuf], 'fake.jpg', { type: 'image/jpeg' });
    const fd = new FormData();
    fd.set('file', file);
    const result = await updateOwnTenantAvatar({}, fd);
    expect(result.error?.code).toBe('IMAGE_INVALID_MIME');
    expect(capturedUploadCalls).toHaveLength(0);
  });

  it('returns IMAGE_INVALID_MIME when MIME type is not in the allowlist (e.g. SVG)', async () => {
    const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const file = new File([svgBuf], 'image.svg', { type: 'image/svg+xml' });
    const fd = new FormData();
    fd.set('file', file);
    const result = await updateOwnTenantAvatar({}, fd);
    expect(result.error?.code).toBe('IMAGE_INVALID_MIME');
    expect(capturedUploadCalls).toHaveLength(0);
  });
});

// ── Rate limit ────────────────────────────────────────────────────────────────

describe('Rate limiting — 5/min per tenant', () => {
  it('returns RATE_LIMITED on the 6th call within the rate limit window', async () => {
    // Allow exactly 5 calls, block on 6th
    rateLimitMax = 5;

    let lastResult;
    for (let i = 0; i < 6; i++) {
      lastResult = await updateOwnTenantAvatar({}, makeAvatarFormData());
    }

    expect(lastResult?.error?.code).toBe('RATE_LIMITED');
    // Only 5 uploads should have succeeded
    expect(capturedUploadCalls.length).toBeLessThanOrEqual(5);
  });
});
