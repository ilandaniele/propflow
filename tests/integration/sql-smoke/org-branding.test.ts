import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: null as null | { userId: string; orgId: string; role: string } }));
vi.mock('@/lib/auth/guards', () => ({
  requireUser: vi.fn(async () => {
    if (!auth.ctx) throw new Error('UNAUTHORIZED');
    return auth.ctx;
  }),
  requireAdmin: vi.fn(async () => {
    if (!auth.ctx) throw new Error('UNAUTHORIZED');
    if (auth.ctx.role !== 'admin') throw new Error('FORBIDDEN');
    return auth.ctx;
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));

const storage = vi.hoisted(() => ({
  uploadImage: vi.fn(async () => undefined),
  deleteImage: vi.fn(async () => undefined),
  getSignedUrl: vi.fn(async (_bucket: string, path: string) => `https://r2.test/${path}`),
}));
vi.mock('@/lib/storage/index', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/storage/index')>()),
  ...storage,
}));

import { GET, PUT } from '@/app/api/org-branding/route';
import { GET as GET_LOGO } from '@/app/api/org-branding/logo/route';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  auth.ctx = null;
  vi.clearAllMocks();
});

function as(role: string, orgId: string) {
  auth.ctx = { userId: `user-${role}`, orgId, role };
}

function put(fields: Record<string, string | File>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return PUT(new NextRequest('http://localhost/api/org-branding', { method: 'PUT', body }));
}

function logoFile(bytes: Buffer, type = 'image/png') {
  return new File([new Uint8Array(bytes)], 'logo.png', { type });
}

async function brandingRow(orgId: string) {
  const [row] = await db.select().from(schema.orgBranding).where(eq(schema.orgBranding.orgId, orgId));
  return row;
}

describe('org branding API (real SQL)', () => {
  it('saves accent color and logo for the admin org and reads them back', async () => {
    const org = await seedOrg(db);
    as('admin', org.id);

    const saved = await put({ accent_color: '#1D4ED8', logo: logoFile(PNG) });
    expect(saved.status).toBe(200);
    const dto = await saved.json();
    expect(dto.accentColor).toBe('#1d4ed8');
    expect(dto.logoUrl).toMatch(/^\/api\/org-branding\/logo\?v=\d+$/);

    const row = await brandingRow(org.id);
    expect(row.logoKey?.startsWith(`${org.id}/branding/`)).toBe(true);
    expect(storage.uploadImage).toHaveBeenCalledWith('org-branding', row.logoKey, expect.any(Buffer), 'image/png');

    const read = await GET();
    expect(await read.json()).toEqual(dto);
  });

  it('keeps the logo on a color-only update and deletes it when asked', async () => {
    const org = await seedOrg(db);
    as('admin', org.id);
    await put({ accent_color: '#111111', logo: logoFile(PNG) });
    const { logoKey } = await brandingRow(org.id);

    await put({ accent_color: '#222222' });
    expect((await brandingRow(org.id)).logoKey).toBe(logoKey);

    await put({ accent_color: '', remove_logo: 'true' });
    const row = await brandingRow(org.id);
    expect(row).toMatchObject({ logoKey: null, accentColor: null });
    expect(storage.deleteImage).toHaveBeenCalledWith('org-branding', logoKey);
  });

  it('isolates orgs: another org can neither read nor overwrite the branding', async () => {
    const orgA = await seedOrg(db);
    const orgB = await seedOrg(db);
    as('admin', orgA.id);
    await put({ accent_color: '#abcdef', logo: logoFile(PNG) });
    const before = await brandingRow(orgA.id);

    as('admin', orgB.id);
    expect(await (await GET()).json()).toEqual({ accentColor: null, logoUrl: null });
    expect((await GET_LOGO()).status).toBe(404);

    await put({ accent_color: '#000000', remove_logo: 'true' });
    expect(await brandingRow(orgA.id)).toEqual(before);
    expect((await brandingRow(orgB.id)).accentColor).toBe('#000000');
    expect(storage.deleteImage).not.toHaveBeenCalled();
  });

  it('streams the logo of the caller org only', async () => {
    const org = await seedOrg(db);
    as('admin', org.id);
    await put({ accent_color: '', logo: logoFile(PNG) });
    const { logoKey } = await brandingRow(org.id);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      as('tenant', org.id);
      const response = await GET_LOGO();
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(storage.getSignedUrl).toHaveBeenCalledWith('org-branding', logoKey);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns 404 for the logo when the org has none', async () => {
    const org = await seedOrg(db);
    as('admin', org.id);
    expect((await GET_LOGO()).status).toBe(404);
  });

  it('forbids non-admins from writing (403)', async () => {
    const org = await seedOrg(db);
    as('tenant', org.id);

    const response = await put({ accent_color: '#123456' });

    expect(response.status).toBe(403);
    expect(await brandingRow(org.id)).toBeUndefined();
  });

  it('rejects unauthenticated reads and writes (401)', async () => {
    expect((await GET()).status).toBe(401);
    expect((await GET_LOGO()).status).toBe(401);
    expect((await put({ accent_color: '#123456' })).status).toBe(401);
  });

  it('rejects bad files and colors without saving', async () => {
    const org = await seedOrg(db);
    as('admin', org.id);

    const spoofed = await put({ accent_color: '', logo: logoFile(Buffer.from('<svg></svg>'), 'image/png') });
    expect(spoofed.status).toBe(400);
    expect((await spoofed.json()).error.code).toBe('IMAGE_INVALID_MIME');

    const svg = await put({ accent_color: '', logo: logoFile(Buffer.from('<svg></svg>'), 'image/svg+xml') });
    expect(svg.status).toBe(400);

    const big = Buffer.concat([PNG, Buffer.alloc(1_048_577 - PNG.length)]);
    const tooLarge = await put({ accent_color: '', logo: logoFile(big) });
    expect(tooLarge.status).toBe(413);

    const badColor = await put({ accent_color: 'red' });
    expect(badColor.status).toBe(400);
    expect((await badColor.json()).error.code).toBe('VALIDATION_ERROR');

    expect(storage.uploadImage).not.toHaveBeenCalled();
    expect(await brandingRow(org.id)).toBeUndefined();
  });
});
