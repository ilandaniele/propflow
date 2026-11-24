/**
 * Real-SQL smoke test for src/app/actions/org-signature.ts's saveOrgSignature:
 * the org_signatures upsert keeps one row per org, and a non-PNG image is
 * rejected before any write. Auth, rate limiting and revalidation are mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', denied: false }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.denied) throw new Error('unauthorized');
    return { userId: 'user-1', orgId: auth.orgId, role: 'admin', profile: {} };
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function signatureRows(orgId: string) {
  return smoke.db.select().from(schema.orgSignatures).where(eq(schema.orgSignatures.orgId, orgId));
}

describe('saveOrgSignature (real SQL)', () => {
  it('inserts, then updates the same row', async () => {
    const { saveOrgSignature } = await import('@/app/actions/org-signature');
    const org = await seedOrg(smoke.db);
    auth.orgId = org.id;
    auth.denied = false;

    expect((await saveOrgSignature(null, form({ signer_name: 'Juan Pérez', signature_image: PNG_DATA_URL }))).error).toBeUndefined();
    expect((await saveOrgSignature(null, form({ signer_name: 'Ana Ruiz', signer_document: '12345678', signature_image: PNG_DATA_URL }))).error).toBeUndefined();

    const rows = await signatureRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ signerName: 'Ana Ruiz', signerDocument: '12345678', imageDataUrl: PNG_DATA_URL });
  });

  it('rejects a data URL whose bytes are not a PNG', async () => {
    const { saveOrgSignature } = await import('@/app/actions/org-signature');
    const org = await seedOrg(smoke.db, { name: 'Fake PNG Org' });
    auth.orgId = org.id;
    auth.denied = false;

    const fake = `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`;
    const result = await saveOrgSignature(null, form({ signer_name: 'Juan Pérez', signature_image: fake }));

    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(await signatureRows(org.id)).toHaveLength(0);
  });

  it('returns UNAUTHORIZED without an admin session', async () => {
    const { saveOrgSignature } = await import('@/app/actions/org-signature');
    auth.denied = true;

    const result = await saveOrgSignature(null, form({ signer_name: 'Juan Pérez', signature_image: PNG_DATA_URL }));

    expect(result.error?.code).toBe('UNAUTHORIZED');
  });
});
