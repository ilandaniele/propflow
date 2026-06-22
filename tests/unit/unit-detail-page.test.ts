/**
 * tests/unit/unit-detail-page.test.ts
 *
 * Integration-style unit tests for the unit detail page Server Component.
 * Mocks Supabase, requireAdmin, notFound, redirect, and next-intl so we can
 * exercise the data-fetching + rendering logic without a real DB or browser.
 *
 * Scenarios covered:
 *   (a) Renders unit label, status, property name, toilet type, created date.
 *   (b) Shows assigned tenant name and link when unit is occupied.
 *   (c) Shows "Unoccupied" when no tenant is assigned.
 *   (d) Calls notFound() when the unit belongs to a different org (cross-org guard).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ---------------------------------------------------------------------------
// Mock next/navigation — notFound() throws a special internal error that
// Next.js intercepts; in tests we just want to confirm it was called.
// ---------------------------------------------------------------------------

const mockNotFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
const mockRedirect  = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });

vi.mock('next/navigation', () => ({
  notFound:  mockNotFound,
  redirect:  mockRedirect,
}));

// ---------------------------------------------------------------------------
// Mock next-intl/server — getTranslations returns a simple key-lookup stub
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn((_ns: string) => {
    const translations: Record<string, string> = {
      'toiletType.private':  'Private',
      'toiletType.shared':   'Shared',
      'toiletType.none':     'No bathroom',
      'detail.backToUnits':  'Back to Units',
      'detail.property':     'Property',
      'detail.status':       'Status',
      'detail.floor':        'Floor',
      'detail.toiletType':   'Bathroom',
      'detail.defaultRent':  'Default Rent',
      'detail.tenant':       'Tenant',
      'detail.unoccupied':   'Unoccupied',
      'detail.createdAt':    'Created',
    };
    return Promise.resolve((key: string) => translations[key] ?? key);
  }),
}));

// ---------------------------------------------------------------------------
// Mock next/link — renders as a plain <a> using React.createElement
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}));

// ---------------------------------------------------------------------------
// Mock @/components/ui/Avatar — renders initials span to avoid image handling
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ name }: { name?: string | null }) =>
    React.createElement('span', { 'data-testid': 'avatar' }, name ?? '?'),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/auth/guards
// ---------------------------------------------------------------------------

const mockRequireAdmin = vi.fn();

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: mockRequireAdmin,
}));

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server
// ---------------------------------------------------------------------------

const mockSingle    = vi.fn();
const mockMaybeSingle = vi.fn();

/**
 * Builds a chainable Supabase query mock.
 * The chain terminates at .single() or .maybeSingle().
 */
function makeSupabaseChain(resolveWith: () => ReturnType<typeof mockSingle>) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'order', 'limit'] as const;
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockImplementation(resolveWith);
  chain.maybeSingle = vi.fn().mockImplementation(resolveWith);
  return chain;
}

const mockCreateClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
  createAdminServerClient: mockCreateClient,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '00000000-0000-0000-0000-000000000002';

const baseUnit = {
  id:                   'unit-001',
  org_id:               ORG_A,
  property_id:          'prop-001',
  label:                'Apt 4B',
  floor:                '4',
  status:               'occupied',
  toilet_type:          'private',
  monthly_rent_default: 1200,
  created_at:           '2024-03-15T10:00:00Z',
  properties:           { id: 'prop-001', name: 'Sunset Residences' },
};

const assignedTenant = {
  id:        'tenant-001',
  full_name: 'Alice Johnson',
};

const ORG_A_CTX = { userId: 'user-001', orgId: ORG_A, role: 'admin' as const, profile: {} as never };

// ---------------------------------------------------------------------------
// Helper — invoke the default export (the page function)
// ---------------------------------------------------------------------------

async function renderPage(paramsId: string) {
  // Dynamic import so vi.mock() hoisting takes effect before the module loads
  const { default: UnitDetailPage } = await import(
    '@/app/dashboard/units/[id]/page'
  );
  return UnitDetailPage({ params: Promise.resolve({ id: paramsId }) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Unit detail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
    mockNotFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    mockRequireAdmin.mockResolvedValue(ORG_A_CTX);
  });

  // (a) Renders unit fields
  it('(a) renders unit label, status, property name, toilet type, and created date', async () => {
    // unit query resolves with data
    const unitChain = makeSupabaseChain(() =>
      Promise.resolve({ data: baseUnit, error: null })
    );
    // tenant query resolves with no tenant
    const tenantChain = makeSupabaseChain(() =>
      Promise.resolve({ data: null, error: null })
    );

    let callIndex = 0;
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockImplementation(() => {
        return callIndex++ === 0 ? unitChain : tenantChain;
      }),
    });

    const element = await renderPage('unit-001');
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Apt 4B');
    expect(html).toContain('Sunset Residences');
    // Status pill renders the status text
    expect(html).toContain('Occupied');
    // toilet_type = 'private' → 'Private' via translation stub
    expect(html).toContain('Private');
    // Created date appears somewhere (year 2024 at minimum)
    expect(html).toMatch(/2024/);
  });

  // (b) Shows assigned tenant name when unit is occupied
  it('(b) shows tenant name and link when a tenant is assigned', async () => {
    const unitChain = makeSupabaseChain(() =>
      Promise.resolve({ data: baseUnit, error: null })
    );
    const tenantChain = makeSupabaseChain(() =>
      Promise.resolve({ data: assignedTenant, error: null })
    );

    let callIndex = 0;
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockImplementation(() => {
        return callIndex++ === 0 ? unitChain : tenantChain;
      }),
    });

    const element = await renderPage('unit-001');
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Alice Johnson');
    // The tenant link should point to /dashboard/tenants/tenant-001
    expect(html).toContain('/dashboard/tenants/tenant-001');
    // "Unoccupied" label should NOT appear
    expect(html).not.toContain('Unoccupied');
  });

  // (c) Shows "Unoccupied" when no tenant is assigned
  it('(c) shows "Unoccupied" when no tenant is assigned to the unit', async () => {
    const vacantUnit = { ...baseUnit, status: 'vacant' };
    const unitChain = makeSupabaseChain(() =>
      Promise.resolve({ data: vacantUnit, error: null })
    );
    const tenantChain = makeSupabaseChain(() =>
      Promise.resolve({ data: null, error: null })
    );

    let callIndex = 0;
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockImplementation(() => {
        return callIndex++ === 0 ? unitChain : tenantChain;
      }),
    });

    const element = await renderPage('unit-001');
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Unoccupied');
    // No tenant link present
    expect(html).not.toContain('/dashboard/tenants/tenant-');
  });

  // (d) Calls notFound() when unit belongs to a different org (cross-org guard)
  it('(d) calls notFound() when the unit is not found in the admin org (cross-org 404 guard)', async () => {
    // Supabase returns null data because the .eq('org_id', orgA) filter
    // excludes the org-B unit (RLS + application-level filter)
    const unitChain = makeSupabaseChain(() =>
      Promise.resolve({ data: null, error: null })
    );

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue(unitChain),
    });

    await expect(renderPage('org-b-unit-999')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  // Extra: unauthenticated caller is redirected to /login
  it('redirects to /login when requireAdmin throws (unauthenticated caller)', async () => {
    mockRequireAdmin.mockRejectedValue(new Error('UNAUTHORIZED'));

    await expect(renderPage('unit-001')).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });
});
