/**
 * Real-SQL smoke test for signing evidence: POST /api/sign/[token] stores the
 * SHA-256 of the stored contract PDF and of the signature image, and
 * getSignatureCertificateSource returns that evidence only for a signed request
 * of the admin's own org. Auth, rate limiting and R2 storage are mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', denied: false }));
const storage = vi.hoisted(() => ({ files: new Map<string, Buffer>() }));
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
vi.mock('@/lib/ratelimit', () => ({
  getClientIp: vi.fn(() => '203.0.113.7'),
  signatureRateLimit: vi.fn(() => ({ success: true })),
  generatePdfRateLimit: vi.fn(() => ({ success: true })),
}));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn(async (_bucket: string, path: string, bytes: Buffer) => {
    storage.files.set(path, bytes);
  }),
  downloadFile: vi.fn(async (_bucket: string, path: string) => {
    const bytes = storage.files.get(path);
    if (!bytes) throw new Error('not found');
    return bytes;
  }),
  getSignedUrl: vi.fn(async (_bucket: string, path: string) => `https://r2.test/${path}`),
}));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const PDF = Buffer.from('%PDF-1.7 smoke contract');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedSignatureRequest(name: string) {
  const org = await seedOrg(smoke.db, { name });
  const property = await seedProperty(smoke.db, org.id);
  const [unit] = await smoke.db
    .insert(schema.units)
    .values({ id: crypto.randomUUID(), orgId: org.id, propertyId: property.id, label: '101' })
    .returning();
  const [tenant] = await smoke.db
    .insert(schema.tenants)
    .values({ id: crypto.randomUUID(), orgId: org.id, fullName: 'Inquilino Prueba', email: 'tenant@example.test' })
    .returning();
  const documentUrl = `${org.id}/contract.pdf`;
  storage.files.set(documentUrl, PDF);
  const [contract] = await smoke.db
    .insert(schema.contracts)
    .values({
      id: crypto.randomUUID(),
      orgId: org.id,
      tenantId: tenant.id,
      unitId: unit.id,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      monthlyRent: 1500,
      documentUrl,
    })
    .returning();
  const [request] = await smoke.db
    .insert(schema.signatureRequests)
    .values({
      id: crypto.randomUUID(),
      orgId: org.id,
      contractId: contract.id,
      signerEmail: 'tenant@example.test',
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return { org, contract, request };
}

function sign(token: string) {
  const request = new NextRequest(`http://localhost/api/sign/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'SmokeBrowser/1.0' },
    body: JSON.stringify({ signature_image_base64: `data:image/png;base64,${PNG.toString('base64')}`, typed_name: 'Inquilino Prueba' }),
  });
  return import('@/app/api/sign/[token]/route').then(({ POST }) => POST(request, { params: Promise.resolve({ token }) }));
}

function certificate(signatureRequestId: string) {
  const data = new FormData();
  data.set('signature_request_id', signatureRequestId);
  return import('@/app/actions/signature-certificate').then(({ getSignatureCertificateSource }) =>
    getSignatureCertificateSource({}, data),
  );
}

describe('signature evidence (real SQL)', () => {
  it('stores IP, user agent and SHA-256 of the PDF and the signature', async () => {
    const { request } = await seedSignatureRequest('Evidence Org');

    const response = await sign(request.token);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'signed', documentSha256: sha256(PDF) });
    const [row] = await smoke.db.select().from(schema.signatureRequests).where(eq(schema.signatureRequests.id, request.id));
    expect(row).toMatchObject({
      status: 'signed',
      signedIp: '203.0.113.7',
      signedUserAgent: 'SmokeBrowser/1.0',
      documentSha256: sha256(PDF),
      signatureSha256: sha256(PNG),
    });
  });

  it('returns the certificate source for a signed request of the admin org', async () => {
    const { org, request } = await seedSignatureRequest('Certificate Org');
    await sign(request.token);
    auth.orgId = org.id;
    auth.denied = false;

    const result = await certificate(request.id);

    expect(result.error).toBeUndefined();
    expect(result.data?.evidence).toMatchObject({ signedIp: '203.0.113.7', documentSha256: sha256(PDF), signatureSha256: sha256(PNG) });
    expect(result.data?.contract).toMatchObject({ orgName: 'Certificate Org', tenant: 'Inquilino Prueba' });
    expect(result.data?.tenantSignature).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  it('returns NOT_FOUND for an unsigned request', async () => {
    const { org, request } = await seedSignatureRequest('Unsigned Org');
    auth.orgId = org.id;
    auth.denied = false;

    expect((await certificate(request.id)).error?.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND for a signed request of another org', async () => {
    const { request } = await seedSignatureRequest('Victim Org');
    await sign(request.token);
    const attacker = await seedOrg(smoke.db, { name: 'Attacker Org' });
    auth.orgId = attacker.id;
    auth.denied = false;

    expect((await certificate(request.id)).error?.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED without an admin session', async () => {
    auth.denied = true;

    expect((await certificate(crypto.randomUUID())).error?.code).toBe('UNAUTHORIZED');
  });
});
