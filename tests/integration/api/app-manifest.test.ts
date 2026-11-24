import { describe, it, expect, vi, beforeEach } from 'vitest';

let profile: unknown = null;
let orgRows: unknown[] = [];

vi.mock('@/lib/auth/guards', () => ({ getProfile: async () => profile }));
vi.mock('@/lib/db', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => orgRows,
  };
  return { db: chain };
});

import { GET } from '@/app/api/app/manifest/route';

beforeEach(() => {
  profile = null;
  orgRows = [];
});

describe('GET /api/app/manifest', () => {
  it('serves the generic manifest without a session', async () => {
    const res = await GET();
    expect(res.headers.get('content-type')).toBe('application/manifest+json');
    expect(await res.json()).toMatchObject({ name: 'PropFlow', start_url: '/login' });
  });

  it('serves the org-branded manifest for a signed-in tenant', async () => {
    profile = { org_id: 'org-1', role: 'tenant' };
    orgRows = [{ name: 'Casa Aurora' }];
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(await res.json()).toMatchObject({ name: 'Casa Aurora', start_url: '/portal' });
  });
});
