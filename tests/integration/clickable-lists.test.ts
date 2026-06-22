/**
 * tests/integration/clickable-lists.test.tsx
 *
 * AC2 + AC4 — Integration tests for ClickableRow wiring in tenants and units lists.
 *
 * Strategy: These are Server Components so we cannot use a browser or hook-based
 * rendering. We use renderToStaticMarkup to exercise the full render path with
 * mocked db / auth / next-intl, then assert on the resulting HTML:
 *
 *   Tenants list (AC2):
 *     (a) Each tenant row is a <tr> with cursor-pointer (ClickableRow rendered).
 *     (b) The row's data-href attribute (or tabIndex / role) is present — ClickableRow
 *         renders a focusable <tr> with tabIndex=0.
 *     (c) The "View" button link still points to /dashboard/tenants/[id].
 *     (d) No absolute-positioned overlay <a class="absolute inset-0"> is present.
 *
 *   Units list (AC4):
 *     (e) Each unit row is a <tr> with cursor-pointer (ClickableRow rendered).
 *     (f) A "View" button link pointing to /dashboard/units/[id] is present.
 */

// @vitest-environment node

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  redirect:  vi.fn(() => { throw new Error('NEXT_REDIRECT'); }),
  notFound:  vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Mock next/link — render as plain <a> so href values are visible in HTML
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

// ---------------------------------------------------------------------------
// Mock next/headers
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Mock next-intl/server
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn((_ns: string) => {
    const t: Record<string, string> = {
      'toiletType.private': 'Private',
      'toiletType.shared':  'Shared',
      'toiletType.none':    'No bathroom',
    };
    return Promise.resolve((key: string) => t[key] ?? key);
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/auth/guards
// ---------------------------------------------------------------------------

const mockRequireAdmin = vi.fn();

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: mockRequireAdmin,
}));

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// ---------------------------------------------------------------------------

// Holds current return values for select/execute calls
let mockTenantRows: unknown[] = [];
let mockUnitRows: unknown[] = [];
let mockPropertyRows: unknown[] = [];
let selectCallCount = 0;

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => {
      const callIndex = selectCallCount++;
      const chain = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn(async () => {
          // For units page: first call = units, second = properties
          if (callIndex === 0 && mockUnitRows.length > 0) return mockUnitRows;
          if (callIndex === 1 && mockPropertyRows.length > 0) return mockPropertyRows;
          // For tenants page: first call = tenants list
          return mockTenantRows;
        }),
      };
      return chain;
    }),
    execute: vi.fn(async () => {
      // tenant_statement view — return empty (no overdue tenants needed for these tests)
      return [];
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => []),
        onConflictDoNothing: vi.fn(async () => []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}));

// ---------------------------------------------------------------------------
// Mock UI components that import from client-only libraries
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ name }: { name?: string | null }) =>
    React.createElement('span', { 'data-testid': 'avatar' }, name ?? '?'),
}));

vi.mock(
  '@/app/dashboard/tenants/CreateTenantForm',
  () => ({ CreateTenantForm: () => React.createElement('div', { 'data-testid': 'create-tenant-form' }) }),
);

vi.mock(
  '@/app/dashboard/units/CreateUnitForm',
  () => ({ CreateUnitForm: () => React.createElement('div', { 'data-testid': 'create-unit-form' }) }),
);

vi.mock(
  '@/app/dashboard/tenants/TenantsCsvButtons',
  () => ({ TenantsCsvButtons: () => React.createElement('div', { 'data-testid': 'tenants-csv-buttons' }) }),
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_A_CTX = { userId: 'user-001', orgId: ORG_A, role: 'admin' as const, profile: {} as never };

const fakeTenants = [
  {
    id:             'tenant-aaa',
    orgId:          ORG_A,
    fullName:       'Alice Smith',
    email:          'alice@example.com',
    phone:          null,
    photoUrl:       null,
    unitId:         'unit-111',
    profileId:      'profile-1',
    documentNumber: null,
    createdAt:      new Date('2024-01-01'),
    unitLabel:      'Apt 1A',
    propertyName:   'Sunrise Tower',
  },
  {
    id:             'tenant-bbb',
    orgId:          ORG_A,
    fullName:       'Bob Jones',
    email:          null,
    phone:          null,
    photoUrl:       null,
    unitId:         null,
    profileId:      null,
    documentNumber: null,
    createdAt:      new Date('2024-02-01'),
    unitLabel:      null,
    propertyName:   null,
  },
];

const fakeUnits = [
  {
    id:                   'unit-111',
    orgId:                ORG_A,
    label:                'Studio 3',
    floor:                '3',
    status:               'occupied',
    toiletType:           'private',
    monthlyRentDefault:   900,
    createdAt:            new Date('2024-01-10'),
    propertyId:           'prop-001',
    propertyName:         'Harbor View',
  },
  {
    id:                   'unit-222',
    orgId:                ORG_A,
    label:                'Penthouse',
    floor:                null,
    status:               'vacant',
    toiletType:           'shared',
    monthlyRentDefault:   null,
    createdAt:            new Date('2024-03-01'),
    propertyId:           'prop-002',
    propertyName:         'The Heights',
  },
];

// ---------------------------------------------------------------------------
// Tests — Tenants list (AC2)
// ---------------------------------------------------------------------------

describe('Tenants list — ClickableRow wiring (AC2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    mockTenantRows = fakeTenants;
    mockUnitRows = [];
    mockPropertyRows = [];
    mockRequireAdmin.mockResolvedValue(ORG_A_CTX);
  });

  async function renderTenantsPage() {
    const { default: TenantsPage } = await import('@/app/dashboard/tenants/page');
    const element = await TenantsPage();
    return renderToStaticMarkup(element as React.ReactElement);
  }

  it('(a) renders tenant rows with cursor-pointer class (ClickableRow active)', async () => {
    const html = await renderTenantsPage();
    expect(html).toContain('cursor-pointer');
  });

  it('(b) tenant rows are keyboard-focusable (tabIndex="0" on <tr>)', async () => {
    const html = await renderTenantsPage();
    expect(html).toContain('tabindex="0"');
  });

  it('(c) "View" link for tenant-aaa points to /dashboard/tenants/tenant-aaa', async () => {
    const html = await renderTenantsPage();
    expect(html).toContain('/dashboard/tenants/tenant-aaa');
  });

  it('(c) "View" link for tenant-bbb points to /dashboard/tenants/tenant-bbb', async () => {
    const html = await renderTenantsPage();
    expect(html).toContain('/dashboard/tenants/tenant-bbb');
  });

  it('(d) no absolute-overlay <a> element remains (broken stretched-link removed)', async () => {
    const html = await renderTenantsPage();
    expect(html).not.toContain('absolute inset-0');
  });

  it('renders tenant names in the list', async () => {
    const html = await renderTenantsPage();
    expect(html).toContain('Alice Smith');
    expect(html).toContain('Bob Jones');
  });
});

// ---------------------------------------------------------------------------
// Tests — Units list (AC4)
// ---------------------------------------------------------------------------

describe('Units list — ClickableRow wiring (AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    mockTenantRows = [];
    mockUnitRows = fakeUnits;
    mockPropertyRows = [{ id: 'prop-001', name: 'Harbor View' }];
    mockRequireAdmin.mockResolvedValue(ORG_A_CTX);
  });

  async function renderUnitsPage() {
    const { default: UnitsPage } = await import('@/app/dashboard/units/page');
    const element = await UnitsPage();
    return renderToStaticMarkup(element as React.ReactElement);
  }

  it('(e) renders unit rows with cursor-pointer class (ClickableRow active)', async () => {
    const html = await renderUnitsPage();
    expect(html).toContain('cursor-pointer');
  });

  it('(e) unit rows are keyboard-focusable (tabIndex="0" on <tr>)', async () => {
    const html = await renderUnitsPage();
    expect(html).toContain('tabindex="0"');
  });

  it('(f) "View" link for unit-111 points to /dashboard/units/unit-111', async () => {
    const html = await renderUnitsPage();
    expect(html).toContain('/dashboard/units/unit-111');
  });

  it('(f) "View" link for unit-222 points to /dashboard/units/unit-222', async () => {
    const html = await renderUnitsPage();
    expect(html).toContain('/dashboard/units/unit-222');
  });

  it('renders unit labels in the list', async () => {
    const html = await renderUnitsPage();
    expect(html).toContain('Studio 3');
    expect(html).toContain('Penthouse');
  });

  it('renders the Actions column header for parity', async () => {
    const html = await renderUnitsPage();
    expect(html.toLowerCase()).toContain('actions');
  });
});
