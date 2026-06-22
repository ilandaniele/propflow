/**
 * Integration regression tests for tenant Server Actions.
 *
 * Covers:
 *   AC15 — Admin updateTenantAvatar (existing path) regression.
 * All DB calls are mocked via @/lib/db — no live DB required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG_ACME    = 'aaaaaa00-0000-0000-0000-000000000001';
const USER_ADMIN  = 'bbbbbb00-0000-0000-0000-000000000001';
const TENANT_ID_T = 'cccccc00-0000-0000-0000-000000000001';
const STORAGE_PATH = `${ORG_ACME}/${TENANT_ID_T}/avatar-uuid.jpg`;

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

interface MockState {
  role: 'admin' | 'tenant';
  userId: string;
  orgId: string;
  dbUpdateError: string | null;
}

const mockState: MockState = {
  role: 'admin',
  userId: USER_ADMIN,
  orgId: ORG_ACME,
  dbUpdateError: null,
};

function resetMockState() {
  mockState.role = 'admin';
  mockState.userId = USER_ADMIN;
  mockState.orgId = ORG_ACME;
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
// Mock: @/lib/db
// ---------------------------------------------------------------------------

const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

function setupUpdateSuccess() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  mockUpdate.mockReturnValue(chain);
  return chain;
}

function setupUpdateError() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockRejectedValue(new Error('DB error')),
  };
  mockUpdate.mockReturnValue(chain);
  return chain;
}

// ---------------------------------------------------------------------------
// Mock: @/lib/ratelimit
// ---------------------------------------------------------------------------

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })),
  actionRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })),
}));

vi.mock('@/lib/log', () => ({
  log: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    adminAction: vi.fn(), authSuccess: vi.fn(), authFailure: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import action AFTER mocks
// ---------------------------------------------------------------------------

import { updateTenantAvatar } from '@/app/actions/tenants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAvatarFormData(tenantId: string, photoUrl: string): FormData {
  const fd = new FormData();
  fd.set('tenant_id', tenantId);
  fd.set('photo_url', photoUrl);
  return fd;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockState();
  vi.clearAllMocks();
  setupUpdateSuccess();
});

// ── AC15: Admin updateTenantAvatar regression ─────────────────────────────────

describe('AC15 — updateTenantAvatar (existing admin path) regression', () => {
  it('returns ok for a valid tenant_id and photo_url', async () => {
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error).toBeUndefined();
  });

  it('updates the tenants row (no error)', async () => {
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error).toBeUndefined();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('returns UNAUTHORIZED when called by a non-admin', async () => {
    mockState.role = 'tenant';
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR for an invalid tenant_id (not a UUID)', async () => {
    const fd = new FormData();
    fd.set('tenant_id', 'not-a-uuid');
    fd.set('photo_url', STORAGE_PATH);
    const result = await updateTenantAvatar({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when photo_url is missing', async () => {
    const fd = new FormData();
    fd.set('tenant_id', TENANT_ID_T);
    const result = await updateTenantAvatar({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns RATE_LIMITED when mutationRateLimit blocks the call', async () => {
    const { mutationRateLimit } = await import('@/lib/ratelimit');
    vi.mocked(mutationRateLimit).mockReturnValueOnce({ success: false, retryAfterMs: 1000 });

    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error?.code).toBe('RATE_LIMITED');
  });

  it('returns INTERNAL_ERROR when DB update fails', async () => {
    setupUpdateError();
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });

  it('accepts a photo_url that is a storage signed URL (≤ 500 chars)', async () => {
    const signedUrl = `https://fly.storage.tigris.dev/tenant-avatars/${STORAGE_PATH}?token=abc`;
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, signedUrl));
    expect(result.error).toBeUndefined();
  });
});
