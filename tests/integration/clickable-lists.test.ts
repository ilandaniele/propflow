/**
 * tests/integration/clickable-lists.test.tsx
 *
 * AC2 + AC4 — Integration tests for ClickableRow wiring in tenants and units lists.
 *
 * Strategy: These are Server Components so we cannot use a browser or hook-based
 * rendering. We use renderToStaticMarkup to exercise the full render path with
 * mocked Supabase / auth / next-intl, then assert on the resulting HTML:
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
 *
 * Note: ClickableRow is a client component ('use client'). renderToStaticMarkup
 * renders it as a server-side HTML snapshot — the onClick/onKeyDown handlers are
 * stripped, but the structural output (tabIndex, role, cursor-pointer class) is
 * verifiable. This is the same trade-off used in unit-detail-page.test.ts.
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
// Mock next/headers (required by createClient → cookies())
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Mock next-intl/server (used by units/page.tsx)
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
// Mock @/lib/supabase/server
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: mockFrom })),
}));

// ---------------------------------------------------------------------------
// Mock UI components that import from client-only libraries
// (Avatar uses next/image internally — stub it out)
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ name }: { name?: string | null }) =>
    React.createElement('span', { 'data-testid': 'avatar' }, name ?? '?'),
}));

// CreateTenantForm and CreateUnitForm are client components; stub them.
vi.mock(
  '@/app/dashboard/tenants/CreateTenantForm',
  () => ({ CreateTenantForm: () => React.createElement('div', { 'data-testid': 'create-tenant-form' }) }),
);

vi.mock(
  '@/app/dashboard/units/CreateUnitForm',
  () => ({ CreateUnitForm: () => React.createElement('div', { 'data-testid': 'create-unit-form' }) }),
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_A_CTX = { userId: 'user-001', orgId: ORG_A, role: 'admin' as const, profile: {} as never };

const fakeTenants = [
  {
    id: 'tenant-aaa',
    org_id: ORG_A,
    full_name: 'Alice Smith',
    email: 'alice@example.com',
    profile_id: 'profile-1',
    created_at: '2024-01-01T00:00:00Z',
    units: { label: 'Apt 1A', properties: { name: 'Sunrise Tower' } },
  },
  {
    id: 'tenant-bbb',
    org_id: ORG_A,
    full_name: 'Bob Jones',
    email: null,
    profile_id: null,
    created_at: '2024-02-01T00:00:00Z',
    units: null,
  },
];

const fakeUnits = [
  {
    id: 'unit-111',
    org_id: ORG_A,
    label: 'Studio 3',
    floor: '3',
    status: 'occupied',
    toilet_type: 'private',
    monthly_rent_default: 900,
    created_at: '2024-01-10T00:00:00Z',
    properties: { name: 'Harbor View' },
  },
  {
    id: 'unit-222',
    org_id: ORG_A,
    label: 'Penthouse',
    floor: null,
    status: 'vacant',
    toilet_type: 'shared',
    monthly_rent_default: null,
    created_at: '2024-03-01T00:00:00Z',
    properties: { name: 'The Heights' },
  },
];

// ---------------------------------------------------------------------------
// Helpers — build the chainable Supabase query mock
// ---------------------------------------------------------------------------

function makeListChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'order'] as const;
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // list queries resolve as { data, error }
  chain.then = undefined; // ensure it's not a thenable by itself
  (chain as Record<string, unknown>)._resolved = Promise.resolve({ data: rows, error: null });
  // Make the chain awaitable at the end of .order()
  chain.order = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

// ---------------------------------------------------------------------------
// Tests — Tenants list (AC2)
// ---------------------------------------------------------------------------

describe('Tenants list — ClickableRow wiring (AC2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(ORG_A_CTX);
  });

  async function renderTenantsPage() {
    // Import after mocks are in place
    const { default: TenantsPage } = await import('@/app/dashboard/tenants/page');
    const element = await TenantsPage();
    return renderToStaticMarkup(element as React.ReactElement);
  }

  beforeEach(() => {
    // tenants query
    mockFrom.mockReturnValue(makeListChain(fakeTenants));
  });

  it('(a) renders tenant rows with cursor-pointer class (ClickableRow active)', async () => {
    const html = await renderTenantsPage();
    // ClickableRow always applies cursor-pointer to the <tr>
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
    // The old pattern had class="absolute inset-0 z-10" — must be gone
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
    mockRequireAdmin.mockResolvedValue(ORG_A_CTX);

    // units query + properties query (Promise.all of two .order() calls)
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      // First call = units, second = properties
      return callCount++ === 0
        ? makeListChain(fakeUnits)
        : makeListChain([{ id: 'prop-001', name: 'Harbor View' }]);
    });
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
