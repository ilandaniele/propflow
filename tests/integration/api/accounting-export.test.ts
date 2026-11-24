import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let requireAdminImpl: () => Promise<{ orgId: string; userId: string }>;
let rateLimitOk = true;
const journalSource = vi.fn();

vi.mock('@/lib/auth/guards', () => ({ requireAdmin: () => requireAdminImpl() }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: () => ({ success: rateLimitOk }) }));
vi.mock('@/lib/accounting/queries', () => ({ journalSource: (...a: unknown[]) => journalSource(...a) }));

import { GET } from '@/app/api/admin/accounting/export/route';

const get = (query: string) => GET(new NextRequest(`http://localhost/api/admin/accounting/export${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitOk = true;
  requireAdminImpl = async () => ({ orgId: 'org-1', userId: 'user-1' });
  journalSource.mockResolvedValue({ payments: [], expenses: [] });
});

describe('GET /api/admin/accounting/export', () => {
  it('401 when not admin', async () => {
    requireAdminImpl = async () => { throw new Error('UNAUTHORIZED'); };
    expect((await get('?month=2026-10')).status).toBe(401);
  });

  it('429 when rate limited', async () => {
    rateLimitOk = false;
    expect((await get('?month=2026-10')).status).toBe(429);
  });

  it('400 on missing or invalid month', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?month=2026-13')).status).toBe(400);
    expect(journalSource).not.toHaveBeenCalled();
  });

  it('200 CSV scoped to the admin org', async () => {
    journalSource.mockResolvedValue({
      payments: [{ id: 'p1', paidAt: '2026-10-05', amount: '900', currency: 'PEN', method: 'transfer', tenantName: 'Ana', reference: null }],
      expenses: [],
    });
    const res = await get('?month=2026-10');
    expect(res.status).toBe(200);
    expect(journalSource).toHaveBeenCalledWith('org-1', '2026-10');
    expect(res.headers.get('content-disposition')).toContain('libro-diario-2026-10.csv');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.text();
    expect(body).toContain('2026-10-05,1,1041,Cobro alquiler - Ana,900.00,0.00,PEN,p1');
  });
});
