/**
 * tests/unit/unit-detail-page.test.ts
 *
 * Integration-style unit tests for the unit detail page Server Component.
 * Migrated from Supabase mock to Drizzle mock (W10).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockNotFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
const mockRedirect  = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });

vi.mock('next/navigation', () => ({
  notFound:  mockNotFound,
  redirect:  mockRedirect,
}));

// ---------------------------------------------------------------------------
// Mock next-intl/server
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
      'status.occupied':     'Occupied',
      'status.vacant':       'Vacant',
      'status.maintenance':  'Under Maintenance',
    };
    return Promise.resolve((key: string) => translations[key] ?? key);
  }),
}));

// ---------------------------------------------------------------------------
// Mock next/link
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}));

// ---------------------------------------------------------------------------
// Mock @/components/ui/Avatar
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
// Mock @/app/actions/unit-images — getUnitImagesAdmin
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/unit-images', () => ({
  getUnitImagesAdmin: vi.fn(async () => ({ data: [], error: undefined })),
  uploadUnitImage: vi.fn(),
  deleteUnitImage: vi.fn(),
  setUnitCoverImage: vi.fn(),
  reorderUnitImages: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// ---------------------------------------------------------------------------

// Control what each query returns
let unitQueryResult: unknown[] = [];
let tenantQueryResult: unknown[] = [];
let queryCallIndex = 0;

vi.mock('@/lib/db', () => {
  return {
    db: {
      select: vi.fn(() => {
        const callIdx = queryCallIndex++;
        const chain = {
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn(() => {
            // First call = unit query (no .limit())
            // Second call = tenant query (has .limit())
            if (callIdx === 0) {
              return Promise.resolve(unitQueryResult);
            }
            return chain;
          }),
          limit: vi.fn(async () => tenantQueryResult),
        };
        return chain;
      }),
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = '00000000-0000-0000-0000-000000000001';

const baseUnit = {
  id:                   'unit-001',
  orgId:                ORG_A,
  propertyId:           'prop-001',
  label:                'Apt 4B',
  floor:                '4',
  status:               'occupied',
  toiletType:           'private',
  areaM2:               null,
  monthlyRentDefault:   1200,
  createdAt:            new Date('2024-03-15T10:00:00Z'),
  propertyName:         'Sunset Residences',
};

const assignedTenant = {
  id:       'tenant-001',
  fullName: 'Alice Johnson',
};

const ORG_A_CTX = { userId: 'user-001', orgId: ORG_A, role: 'admin' as const, profile: {} as never };

// ---------------------------------------------------------------------------
// Helper — invoke the page function
// ---------------------------------------------------------------------------

async function renderPage(paramsId: string) {
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
    queryCallIndex = 0;
    unitQueryResult = [];
    tenantQueryResult = [];
    mockRedirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
    mockNotFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    mockRequireAdmin.mockResolvedValue(ORG_A_CTX);
  });

  it('(a) renders unit label, status, property name, toilet type, and created date', async () => {
    unitQueryResult = [baseUnit];
    tenantQueryResult = [];

    const element = await renderPage('unit-001');
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Apt 4B');
    expect(html).toContain('Sunset Residences');
    expect(html).toContain('Occupied');
    expect(html).toContain('Private');
    expect(html).toMatch(/2024/);
  });

  it('(b) shows tenant name and link when a tenant is assigned', async () => {
    unitQueryResult  = [baseUnit];
    tenantQueryResult = [assignedTenant];

    const element = await renderPage('unit-001');
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Alice Johnson');
    expect(html).toContain('/dashboard/tenants/tenant-001');
    expect(html).not.toContain('Unoccupied');
  });

  it('(c) shows "Unoccupied" when no tenant is assigned to the unit', async () => {
    unitQueryResult  = [{ ...baseUnit, status: 'vacant' }];
    tenantQueryResult = [];

    const element = await renderPage('unit-001');
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(html).toContain('Unoccupied');
    expect(html).not.toContain('/dashboard/tenants/tenant-');
  });

  it('(d) calls notFound() when the unit is not found in the admin org (cross-org 404 guard)', async () => {
    unitQueryResult  = [];   // empty → notFound()
    tenantQueryResult = [];

    await expect(renderPage('org-b-unit-999')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('redirects to /login when requireAdmin throws (unauthenticated caller)', async () => {
    mockRequireAdmin.mockRejectedValue(new Error('UNAUTHORIZED'));

    await expect(renderPage('unit-001')).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });
});
