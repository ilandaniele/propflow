import { describe, it, expect, vi, beforeEach } from 'vitest';

let requireAdminImpl: () => Promise<{ orgId: string; userId: string }>;
let rateLimitOk = true;
const orgDataZip = vi.fn();
const adminAction = vi.fn();

vi.mock('@/lib/auth/guards', () => ({ requireAdmin: () => requireAdminImpl() }));
vi.mock('@/lib/ratelimit', () => ({ dataExportRateLimit: (orgId: string) => ({ success: rateLimitOk, orgId }) }));
vi.mock('@/lib/data-export/export', () => ({ orgDataZip: (...a: unknown[]) => orgDataZip(...a) }));
vi.mock('@/lib/log', () => ({ log: { adminAction: (...a: unknown[]) => adminAction(...a), error: vi.fn() } }));

import { GET } from '@/app/api/admin/data-export/route';

async function* fakeZip(): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode('PK-fake');
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitOk = true;
  requireAdminImpl = async () => ({ orgId: 'org-1', userId: 'user-1' });
  orgDataZip.mockImplementation(() => fakeZip());
});

describe('GET /api/admin/data-export', () => {
  it('401 when not signed in', async () => {
    requireAdminImpl = async () => { throw new Error('UNAUTHORIZED'); };
    const res = await GET();
    expect(res.status).toBe(401);
    expect(orgDataZip).not.toHaveBeenCalled();
  });

  it('403 for tenants and restricted staff', async () => {
    requireAdminImpl = async () => { throw new Error('FORBIDDEN'); };
    const res = await GET();
    expect(res.status).toBe(403);
    expect(orgDataZip).not.toHaveBeenCalled();
    expect(adminAction).not.toHaveBeenCalled();
  });

  it('429 when rate limited', async () => {
    rateLimitOk = false;
    expect((await GET()).status).toBe(429);
    expect(orgDataZip).not.toHaveBeenCalled();
  });

  it('200 streams a ZIP of the caller org only and audits it', async () => {
    requireAdminImpl = async () => ({ orgId: 'org-2', userId: 'user-9' });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(orgDataZip).toHaveBeenCalledWith('org-2', expect.any(Date));
    expect(adminAction).toHaveBeenCalledWith('user-9', 'org.data_export', 'organization', 'org-2');
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="propflow-datos-\d{4}-\d{2}-\d{2}\.zip"/);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('PK-fake');
  });
});
