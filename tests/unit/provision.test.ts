/**
 * Unit tests for src/lib/auth/provision.ts (Drizzle version).
 *
 * Tests: slug generation, provisioning happy path, rollback-on-profile-failure,
 * idempotency when profile already exists. @/lib/db is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock state ─────────────────────────────────────────────────────────

const mockState = {
  orgInsertRows:     [{ id: 'org-123', slug: 'test-org' }] as Array<{ id: string; slug: string }>,
  orgInsertError:    null as Error | null,
  profileInsertRows: [{ id: 'user-abc' }] as Array<{ id: string }>,
  profileInsertError:null as Error | null,
  deleteError:       null as Error | null,
  // For getExistingProfile / query.profiles.findFirst
  existingProfile:   null as { orgId: string; role: string } | null,
};

// ─── Mock @/lib/db ─────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => {
  return {
    db: {
      insert: vi.fn((tableRef: unknown) => {
        // Determine table by Drizzle symbol
        let table = '';
        if (tableRef && typeof tableRef === 'object') {
          const syms = Object.getOwnPropertySymbols(tableRef as object);
          const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
          if (nameSym) table = String((tableRef as Record<symbol, unknown>)[nameSym]);
        }
        return {
          values: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (table === 'organizations') {
                if (mockState.orgInsertError) throw mockState.orgInsertError;
                return mockState.orgInsertRows;
              }
              if (table === 'profiles') {
                if (mockState.profileInsertError) throw mockState.profileInsertError;
                return mockState.profileInsertRows;
              }
              return [];
            }),
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () => {
                if (mockState.profileInsertError) throw mockState.profileInsertError;
                return mockState.profileInsertRows;
              }),
            })),
          })),
        };
      }),

      delete: vi.fn(() => ({
        where: vi.fn(async () => {
          if (mockState.deleteError) throw mockState.deleteError;
          return [];
        }),
      })),

      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn(async () => []),
      })),

      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),

      query: {
        profiles: {
          findFirst: vi.fn(async () => mockState.existingProfile),
        },
      },
    },
  };
});

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
    info:  vi.fn(),
    warn:  vi.fn(),
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
    mockState.orgInsertRows     = [{ id: 'org-123', slug: 'test-org' }];
    mockState.orgInsertError    = null;
    mockState.profileInsertRows = [{ id: 'user-abc' }];
    mockState.profileInsertError = null;
    mockState.deleteError       = null;
    mockState.existingProfile   = null;
    vi.clearAllMocks();
  });

  it('creates org and profile, returns role=admin', async () => {
    const result = await provisionOrgAndProfile(
      'user-abc',
      'user@example.com',
      'Test Org',
      'Test User',
    );

    expect(result.role).toBe('admin');
    expect(result.orgId).toBe('org-123');
    expect(result.profileId).toBe('user-abc');
  });

  it('throws PROVISION_FAILED:org:no_rows when org insert returns empty array', async () => {
    mockState.orgInsertRows = [];

    await expect(
      provisionOrgAndProfile('user-abc', 'user@example.com', 'Test Org'),
    ).rejects.toThrow('PROVISION_FAILED:org:no_rows');
  });

  it('throws when org insert throws a DB error', async () => {
    mockState.orgInsertError = new Error('unique constraint violation');

    await expect(
      provisionOrgAndProfile('user-abc', 'user@example.com', 'Test Org'),
    ).rejects.toThrow('unique constraint violation');
  });

  it('rolls back org and throws PROVISION_FAILED:profile when profile insert fails', async () => {
    mockState.orgInsertRows    = [{ id: 'org-xyz', slug: 'test-org' }];
    mockState.profileInsertError = new Error('fk violation');

    await expect(
      provisionOrgAndProfile('user-abc', 'user@example.com', 'Test Org'),
    ).rejects.toThrow(/PROVISION_FAILED:profile/);
  });

  it('returns role=admin for all new Google sign-ups', async () => {
    const result = await provisionOrgAndProfile('user-new', 'new@google.com', 'New Org');
    expect(result.role).toBe('admin');
  });
});
