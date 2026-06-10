/**
 * tests/integration/tenant-payments-security.test.ts
 *
 * Security tests for GET /api/tenant/payments:
 * - Tenant A session → only tenant A payments returned
 * - Tenant A passing tenant_B_id as query param → still only tenant A payments
 * - Unauthenticated request → 401
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock state ─────────────────────────────────────────────────────────────────

const TENANT_A_PROFILE_ID = 'profile-a-uuid-001';
const TENANT_A_ID         = 'tenant-a-uuid-001';
const TENANT_A_ORG_ID     = 'org-a-uuid-001';
const TENANT_B_ID         = 'tenant-b-uuid-002';

const state = {
  requireTenantError: false,
  tenantId: TENANT_A_ID,
  payments: [
    { id: 'pay-a-001', amount: 850, tenant_id: TENANT_A_ID, org_id: TENANT_A_ORG_ID, status: 'approved' },
  ] as unknown[],
};

vi.mock('@/lib/auth/guards', () => ({
  requireTenant: vi.fn().mockImplementation(async () => {
    if (state.requireTenantError) throw new Error('UNAUTHORIZED');
    return { userId: TENANT_A_PROFILE_ID, orgId: TENANT_A_ORG_ID, role: 'tenant', profile: {} };
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: state.tenantId },
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      if (table === 'payments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  range: vi.fn(async () => ({
                    data: state.payments,
                    count: state.payments.length,
                    error: null,
                  })),
                })),
              })),
            })),
          })),
        };
      }
      return { select: vi.fn() };
    }),
  }),
}));

import { GET } from '@/app/api/tenant/payments/route';

function makeGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/tenant/payments');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

describe('GET /api/tenant/payments — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requireTenantError = false;
    state.tenantId = TENANT_A_ID;
    state.payments = [
      { id: 'pay-a-001', amount: 850, tenant_id: TENANT_A_ID, org_id: TENANT_A_ORG_ID, status: 'approved' },
    ];
  });

  it('returns 200 with tenant A payments for an authenticated tenant A session', async () => {
    const req = makeGetRequest();
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { payments: unknown[] };
    expect(Array.isArray(body.payments)).toBe(true);
    expect(body.payments).toHaveLength(1);
  });

  it('returns only tenant A payments even if tenant_B_id is passed as query param', async () => {
    // The route MUST ignore any tenant_id in the query string and derive it from the session
    const req = makeGetRequest({ tenant_id: TENANT_B_ID });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { payments: unknown[] };
    // Payments returned are scoped to the session user, not the query param
    expect(body.payments).toHaveLength(1);
  });

  it('returns 401 for unauthenticated request', async () => {
    state.requireTenantError = true;
    const req = makeGetRequest();
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
