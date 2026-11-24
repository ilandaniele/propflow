import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { rentalApplications } from '@/lib/db/schema';
import { createSmokeDb, seedListing, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const auth = vi.hoisted(() => ({ orgId: '', fail: false }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.fail) throw new Error('unauthorized');
    return { userId: 'user-1', orgId: auth.orgId, role: 'admin', profile: {} };
  }),
}));

const publicOrg = vi.hoisted(() => ({ current: null as { id: string; slug: string } | null }));
vi.mock('@/lib/public/catalog', () => ({ getPublicOrg: vi.fn(async () => publicOrg.current) }));

const uploadFile = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  uploadFile,
  getSignedUrl: vi.fn(async () => 'https://signed.example/doc'),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn(() => ({ success: true })),
  actionRateLimit: vi.fn(() => ({ success: true })),
  clientIpFromHeaders: vi.fn(() => '127.0.0.1'),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function applicationForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields = {
    full_name: 'Ana Pérez',
    email: 'ana@example.com',
    phone: '987654321',
    monthly_income: '6000',
    employment_type: 'employee',
    employment_months: '24',
    household_size: '2',
    privacy_accepted: 'on',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function seedPublicOrg(db: SmokeDb) {
  const org = await seedOrg(db);
  publicOrg.current = { id: org.id, slug: 'smoke' };
  auth.orgId = org.id;
  return org;
}

describe('rental applications (real SQL)', () => {
  it('stores a scored application using the listing rent and uploads documents', async () => {
    const db = smoke.db;
    const org = await seedPublicOrg(db);
    const property = await seedProperty(db, org.id);
    const listing = await seedListing(db, org.id, {
      propertyId: property.id, operation: 'rent', published: true, status: 'available', price: '2000', title: 'Depa', publicSlug: 'depa-smoke',
    });
    const { submitRentalApplication } = await import('@/app/actions/rental-application');

    const form = applicationForm({ listing_slug: 'depa-smoke' });
    form.append('documents', new File([Buffer.from('%PDF-1.7\n')], 'boleta.pdf', { type: 'application/pdf' }));
    const result = await submitRentalApplication('smoke', null, form);

    expect(result.error).toBeUndefined();
    const rows = await db.select().from(rentalApplications).where(eq(rentalApplications.orgId, org.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ listingId: listing.id, monthlyRent: '2000', score: 75, status: 'new' });
    expect(rows[0].documents).toHaveLength(1);
    expect(rows[0].documents[0].path.startsWith(`${org.id}/applications/${rows[0].id}/`)).toBe(true);
    expect(uploadFile).toHaveBeenCalledOnce();
  });

  it('silently drops honeypot submissions', async () => {
    const db = smoke.db;
    const org = await seedPublicOrg(db);
    const { submitRentalApplication } = await import('@/app/actions/rental-application');

    const result = await submitRentalApplication('smoke', null, applicationForm({ website: 'spam' }));

    expect(result.error).toBeUndefined();
    expect(await db.select().from(rentalApplications).where(eq(rentalApplications.orgId, org.id))).toHaveLength(0);
  });

  it('rejects invalid input and forged documents', async () => {
    await seedPublicOrg(smoke.db);
    const { submitRentalApplication } = await import('@/app/actions/rental-application');

    const missingPrivacy = await submitRentalApplication('smoke', null, applicationForm({ privacy_accepted: '' }));
    expect(missingPrivacy.error?.code).toBe('VALIDATION_ERROR');

    const forged = applicationForm();
    forged.append('documents', new File(['<html>'], 'x.pdf', { type: 'application/pdf' }));
    expect((await submitRentalApplication('smoke', null, forged)).error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND for an unknown public org', async () => {
    publicOrg.current = null;
    const { submitRentalApplication } = await import('@/app/actions/rental-application');
    expect((await submitRentalApplication('nope', null, applicationForm())).error?.code).toBe('NOT_FOUND');
  });

  it('updates status only inside the admin org', async () => {
    const db = smoke.db;
    const org = await seedPublicOrg(db);
    const { submitRentalApplication, updateRentalApplicationStatus } = await import('@/app/actions/rental-application');
    await submitRentalApplication('smoke', null, applicationForm());
    const [row] = await db.select().from(rentalApplications).where(eq(rentalApplications.orgId, org.id));

    const form = new FormData();
    form.set('application_id', row.id);
    form.set('status', 'approved');

    const other = await seedOrg(db);
    auth.orgId = other.id;
    expect((await updateRentalApplicationStatus(form)).error?.code).toBe('NOT_FOUND');

    auth.orgId = org.id;
    expect((await updateRentalApplicationStatus(form)).error).toBeUndefined();
    const [updated] = await db.select().from(rentalApplications).where(eq(rentalApplications.id, row.id));
    expect(updated.status).toBe('approved');
  });

  it('rejects status updates without an admin session', async () => {
    auth.fail = true;
    const { updateRentalApplicationStatus } = await import('@/app/actions/rental-application');
    const form = new FormData();
    form.set('application_id', crypto.randomUUID());
    form.set('status', 'approved');
    expect((await updateRentalApplicationStatus(form)).error?.code).toBe('UNAUTHORIZED');
    auth.fail = false;
  });
});
