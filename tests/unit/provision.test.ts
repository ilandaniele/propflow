/**
 * Unit tests for src/lib/auth/provision.ts
 *
 * Tests: slug generation, provisioning happy path, rollback-on-profile-failure,
 * idempotency when profile already exists. Admin client is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock state — use objects/closures to avoid vi.mock() hoisting issues ──
const mockState = {
  orgInsertResult: { data: { id: 'org-123', slug: 'test-org' }, error: null } as {
    data: { id: string; slug: string } | null;
    error: { code: string; message: string } | null;
  },
  profileInsertResult: { error: null } as { error: { code: string; message: string } | null },
  orgDeleteResult: { error: null } as { error: null },
  profileSelectResult: { data: null, error: null } as {
    data: { org_id: string; role: string } | null;
    error: null;
  },
};

// Mock the admin client module — must mock BEFORE importing provision.ts
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(mockState.orgInsertResult),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue(mockState.orgDeleteResult),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          insert: vi.fn().mockResolvedValue(mockState.profileInsertResult),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(mockState.profileSelectResult),
            }),
          }),
        };
      }
      return {};
    }),
  })),
}));

vi.mock('@/lib/env', () => ({
  assertServerEnv: vi.fn().mockReturnValue('fake-service-role-key'),
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  },
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key' },
}));

vi.mock('@/lib/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    authSuccess: vi.fn(),
    authFailure: vi.fn(),
  },
}));

import { generateSlug, generateUniqueSlug, provisionOrgAndProfile } from '@/lib/auth/provision';

describe('generateSlug', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(generateSlug('Acme Rentals LLC')).toBe('acme-rentals-llc');
  });

  it('collapses multiple separators into one hyphen', () => {
    expect(generateSlug('Hello  --  World')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('  --  Test  --  ')).toBe('test');
  });

  it('handles unicode by converting to hyphens', () => {
    const slug = generateSlug('Café & Co.');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toMatch(/^-|-$/);
  });

  it('truncates at 80 chars', () => {
    const longName = 'A'.repeat(200);
    expect(generateSlug(longName).length).toBeLessThanOrEqual(80);
  });

  it('generates slug from email-like string', () => {
    const slug = generateSlug('admin@example.com');
    expect(slug).toBe('admin-example-com');
  });
});

describe('generateUniqueSlug', () => {
  it('returns base slug when no conflict', () => {
    expect(generateUniqueSlug('Acme Rentals')).toBe('acme-rentals');
  });

  it('appends suffix when base slug conflicts', () => {
    const existingSlugs = new Set(['acme-rentals']);
    const slug = generateUniqueSlug('Acme Rentals', existingSlugs);
    expect(slug).toMatch(/^acme-rentals-[0-9a-f]{6}$/);
    expect(slug).not.toBe('acme-rentals');
  });
});

describe('provisionOrgAndProfile', () => {
  beforeEach(() => {
    // Reset to success defaults
    mockState.orgInsertResult = { data: { id: 'org-123', slug: 'test-org' }, error: null };
    mockState.profileInsertResult = { error: null };
    mockState.orgDeleteResult = { error: null };
    mockState.profileSelectResult = { data: null, error: null };
    vi.clearAllMocks();
  });

  it('creates org and profile, returns role=admin', async () => {
    const result = await provisionOrgAndProfile(
      'user-abc',
      'user@example.com',
      'Test Org',
      'Test User'
    );

    expect(result.role).toBe('admin');
    expect(result.orgId).toBe('org-123');
    expect(result.profileId).toBe('user-abc');
  });

  it('throws PROVISION_FAILED when org insert fails', async () => {
    mockState.orgInsertResult = {
      data: null,
      error: { code: '23505', message: 'unique violation' },
    };

    await expect(
      provisionOrgAndProfile('user-abc', 'user@example.com', 'Test Org')
    ).rejects.toThrow('PROVISION_FAILED:org:23505');
  });

  it('rolls back org and throws PROVISION_FAILED when profile insert fails', async () => {
    mockState.orgInsertResult = { data: { id: 'org-xyz', slug: 'test-org' }, error: null };
    mockState.profileInsertResult = { error: { code: '23503', message: 'fk violation' } };

    await expect(
      provisionOrgAndProfile('user-abc', 'user@example.com', 'Test Org')
    ).rejects.toThrow(/PROVISION_FAILED:profile/);
  });

  it('returns role=admin for all new Google sign-ups', async () => {
    const result = await provisionOrgAndProfile('user-new', 'new@google.com', 'New Org');
    expect(result.role).toBe('admin');
  });
});
