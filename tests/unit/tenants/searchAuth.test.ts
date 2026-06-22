/**
 * Unit tests for attemptAutoLink in src/lib/auth/provision.ts
 * Uses Drizzle ORM — mocks @/lib/db instead of Supabase admin client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock state ──────────────────────────────────────────────────────────────

const state = {
  tenantsRows: [] as Array<{ id: string; orgId: string }>,
  tenantsError: false,
  profileInsertRows: [] as Array<{ id: string }>,
  profileInsertError: false,
  profileFindFirst: null as { id: string } | null,
  tenantUpdateError: false,
};

// ─── Mock @/lib/db ────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockQueryProfilesFindFirst = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    query: {
      profiles: {
        findFirst: (...args: unknown[]) => mockQueryProfilesFindFirst(...args),
      },
    },
  },
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { attemptAutoLink } from '@/lib/auth/provision';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupSelectResult() {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(() => {
      if (state.tenantsError) throw new Error('DB error');
      return Promise.resolve(state.tenantsRows);
    }),
  };
  mockSelect.mockReturnValue(chain);
}

function setupInsertProfileChain() {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn(() => {
      if (state.profileInsertError) throw new Error('insert error');
      return Promise.resolve(state.profileInsertRows);
    }),
  };
  mockInsert.mockReturnValue(chain);
}

function setupUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(() => {
      if (state.tenantUpdateError) throw new Error('update error');
      return Promise.resolve([]);
    }),
  };
  mockUpdate.mockReturnValue(chain);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.tenantsRows = [];
  state.tenantsError = false;
  state.profileInsertRows = [{ id: 'profile-new' }];
  state.profileInsertError = false;
  state.profileFindFirst = null;
  state.tenantUpdateError = false;

  setupSelectResult();
  setupInsertProfileChain();
  setupUpdateChain();
  mockQueryProfilesFindFirst.mockResolvedValue(state.profileFindFirst);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('attemptAutoLink', () => {
  it('returns no_match when 0 tenants match email', async () => {
    state.tenantsRows = [];
    setupSelectResult();
    const result = await attemptAutoLink('user-1', 'nobody@example.com');
    expect(result).toEqual({ linked: false, reason: 'no_match' });
  });

  it('returns ambiguous_match when 2+ tenants share email', async () => {
    state.tenantsRows = [
      { id: 'tenant-a', orgId: 'org-1' },
      { id: 'tenant-b', orgId: 'org-2' },
    ];
    setupSelectResult();
    const result = await attemptAutoLink('user-2', 'shared@example.com');
    expect(result).toEqual({ linked: false, reason: 'ambiguous_match' });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns { linked: true } and calls profile insert + tenant update on single match', async () => {
    state.tenantsRows = [{ id: 'tenant-c', orgId: 'org-3' }];
    state.profileInsertRows = [{ id: 'profile-xyz' }];
    setupSelectResult();
    setupInsertProfileChain();

    const result = await attemptAutoLink('user-3', 'unique@example.com');
    expect(result).toEqual({ linked: true, orgId: 'org-3' });
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('returns no_match on DB error querying tenants (fail safe)', async () => {
    state.tenantsError = true;
    setupSelectResult();
    const result = await attemptAutoLink('user-4', 'error@example.com');
    expect(result).toEqual({ linked: false, reason: 'no_match' });
  });

  it('handles 23505 / concurrent request: profile already exists → fetches it and links tenant', async () => {
    state.tenantsRows = [{ id: 'tenant-e', orgId: 'org-5' }];
    // insert returns no rows (conflict)
    state.profileInsertRows = [];
    setupSelectResult();
    setupInsertProfileChain();
    // findFirst returns the existing profile
    mockQueryProfilesFindFirst.mockResolvedValue({ id: 'existing-profile' });

    const result = await attemptAutoLink('user-6', 'race@example.com');
    expect(mockUpdate).toHaveBeenCalled();
    expect(result).toEqual({ linked: true, orgId: 'org-5' });
  });
});
