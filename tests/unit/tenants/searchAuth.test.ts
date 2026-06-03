/**
 * Unit tests for attemptAutoLink in src/lib/auth/provision.ts
 *
 * Tests the auto-link logic in isolation without hitting Supabase.
 *
 * Scenarios:
 * 1. No tenants match email → { linked: false, reason: 'no_match' }
 * 2. Exactly 1 tenant matches → profile created + tenant updated → { linked: true }
 * 3. 2+ tenants match same email → { linked: false, reason: 'ambiguous_match' }
 * 4. DB error on tenants query → { linked: false, reason: 'no_match' } (fail safe)
 * 5. DB error on profiles insert → { linked: false, reason: 'no_match' }
 * 6. Profile already exists (23505 unique violation) → still tries to set tenants.profile_id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock admin client ────────────────────────────────────────────────────────

const state = {
  tenantsData: null as Array<{ id: string; org_id: string; email: string }> | null,
  tenantsError: null as { code: string } | null,
  profileInsertError: null as { code: string } | null,
  tenantUpdateError: null as { code: string } | null,
};

const mockIlike = vi.fn();
const mockIsNull = vi.fn();
const mockProfileInsert = vi.fn();
const mockTenantUpdate = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            ilike: (_col: string, _val: string) => ({
              is: (_col2: string, _val2: null) => mockIsNull(),
            }),
          }),
          update: () => ({
            eq: () => ({
              is: () => mockTenantUpdate(),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          insert: () => mockProfileInsert(),
        };
      }
      return {};
    }),
  })),
}));

vi.mock('@/lib/env', () => ({
  assertServerEnv: vi.fn().mockReturnValue('fake-key'),
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'fake-key' },
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { attemptAutoLink } from '@/lib/auth/provision';

describe('attemptAutoLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tenantsData = [];
    state.tenantsError = null;
    state.profileInsertError = null;
    state.tenantUpdateError = null;

    mockIsNull.mockResolvedValue({ data: state.tenantsData, error: state.tenantsError });
    mockProfileInsert.mockResolvedValue({ error: null });
    mockTenantUpdate.mockResolvedValue({ error: null });
  });

  it('returns no_match when 0 tenants match email', async () => {
    mockIsNull.mockResolvedValue({ data: [], error: null });
    const result = await attemptAutoLink('user-1', 'nobody@example.com');
    expect(result).toEqual({ linked: false, reason: 'no_match' });
  });

  it('returns ambiguous_match when 2+ tenants share email', async () => {
    mockIsNull.mockResolvedValue({
      data: [
        { id: 'tenant-a', org_id: 'org-1', email: 'shared@example.com' },
        { id: 'tenant-b', org_id: 'org-2', email: 'shared@example.com' },
      ],
      error: null,
    });
    const result = await attemptAutoLink('user-2', 'shared@example.com');
    expect(result).toEqual({ linked: false, reason: 'ambiguous_match' });
    // No profile insert, no tenant update
    expect(mockProfileInsert).not.toHaveBeenCalled();
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });

  it('returns { linked: true } and calls profile insert + tenant update on single match', async () => {
    mockIsNull.mockResolvedValue({
      data: [{ id: 'tenant-c', org_id: 'org-3', email: 'unique@example.com' }],
      error: null,
    });
    mockProfileInsert.mockResolvedValue({ error: null });
    mockTenantUpdate.mockResolvedValue({ error: null });

    const result = await attemptAutoLink('user-3', 'unique@example.com');
    expect(result).toEqual({ linked: true, orgId: 'org-3' });
    expect(mockProfileInsert).toHaveBeenCalled();
    expect(mockTenantUpdate).toHaveBeenCalled();
  });

  it('returns no_match on DB error querying tenants (fail safe)', async () => {
    mockIsNull.mockResolvedValue({ data: null, error: { code: '42501' } });
    const result = await attemptAutoLink('user-4', 'error@example.com');
    expect(result).toEqual({ linked: false, reason: 'no_match' });
  });

  it('returns no_match when profile insert fails (non-23505 error)', async () => {
    mockIsNull.mockResolvedValue({
      data: [{ id: 'tenant-d', org_id: 'org-4', email: 'fail@example.com' }],
      error: null,
    });
    mockProfileInsert.mockResolvedValue({ error: { code: '42501' } });
    mockTenantUpdate.mockResolvedValue({ error: null });

    const result = await attemptAutoLink('user-5', 'fail@example.com');
    // Non-23505 code → considered a failure → no_match
    expect(result.linked).toBe(false);
  });

  it('handles 23505 unique violation gracefully (concurrent request race)', async () => {
    mockIsNull.mockResolvedValue({
      data: [{ id: 'tenant-e', org_id: 'org-5', email: 'race@example.com' }],
      error: null,
    });
    // 23505 = profile already exists from a concurrent request
    mockProfileInsert.mockResolvedValue({ error: { code: '23505' } });
    mockTenantUpdate.mockResolvedValue({ error: null });

    const result = await attemptAutoLink('user-6', 'race@example.com');
    // Should still try to update the tenant and return linked = true
    expect(mockTenantUpdate).toHaveBeenCalled();
    expect(result).toEqual({ linked: true, orgId: 'org-5' });
  });

  it('returns no_match when tenant update fails after profile insert', async () => {
    mockIsNull.mockResolvedValue({
      data: [{ id: 'tenant-f', org_id: 'org-6', email: 'updatefail@example.com' }],
      error: null,
    });
    mockProfileInsert.mockResolvedValue({ error: null });
    mockTenantUpdate.mockResolvedValue({ error: { code: '42501' } });

    const result = await attemptAutoLink('user-7', 'updatefail@example.com');
    expect(result.linked).toBe(false);
  });
});
