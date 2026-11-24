/** Real-SQL smoke test for staff roles (#23): upsert, clear, self-change and cross-org guards. */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin', profile: { id: '' } } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => auth.ctx),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(profileId: string, role: string) {
  const f = new FormData();
  f.set('profile_id', profileId);
  f.set('role', role);
  return f;
}

const roleOf = async (profileId: string) =>
  (await db.select().from(schema.staffRoles).where(eq(schema.staffRoles.profileId, profileId)))[0]?.role ?? null;

async function seedTeam() {
  const org = await seedOrg(db);
  const owner = await seedProfile(db, org.id, { email: `owner-${crypto.randomUUID()}@example.com` });
  const member = await seedProfile(db, org.id, { email: `member-${crypto.randomUUID()}@example.com` });
  auth.ctx = { userId: owner.id, orgId: org.id, role: 'admin', profile: { id: owner.id } };
  return { org, owner, member };
}

describe('setStaffRoleAction (real SQL)', () => {
  it('assigns, changes and clears a staff role', async () => {
    const { org, member } = await seedTeam();
    const { setStaffRoleAction } = await import('@/app/actions/team');
    const { listTeam } = await import('@/lib/team/queries');

    expect(await setStaffRoleAction(null, form(member.id, 'finance'))).not.toHaveProperty('error');
    expect(await roleOf(member.id)).toBe('finance');

    expect(await setStaffRoleAction(null, form(member.id, 'viewer'))).not.toHaveProperty('error');
    expect(await roleOf(member.id)).toBe('viewer');
    expect((await listTeam(org.id)).find((m) => m.profileId === member.id)?.staffRole).toBe('viewer');

    expect(await setStaffRoleAction(null, form(member.id, 'admin'))).not.toHaveProperty('error');
    expect(await roleOf(member.id)).toBeNull();
  });

  it('refuses to change your own role', async () => {
    const { owner } = await seedTeam();
    const { setStaffRoleAction } = await import('@/app/actions/team');
    const res = await setStaffRoleAction(null, form(owner.id, 'viewer'));
    expect(res).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await roleOf(owner.id)).toBeNull();
  });

  it('returns NOT_FOUND for a profile of another org or a tenant', async () => {
    const { org } = await seedTeam();
    const other = await seedOrg(db);
    const stranger = await seedProfile(db, other.id, { email: `x-${crypto.randomUUID()}@example.com` });
    const tenant = await seedProfile(db, org.id, { role: 'tenant', email: `t-${crypto.randomUUID()}@example.com` });
    const { setStaffRoleAction } = await import('@/app/actions/team');

    expect(await setStaffRoleAction(null, form(stranger.id, 'finance'))).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await setStaffRoleAction(null, form(tenant.id, 'finance'))).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await roleOf(stranger.id)).toBeNull();
  });

  it('rejects an unknown role', async () => {
    const { member } = await seedTeam();
    const { setStaffRoleAction } = await import('@/app/actions/team');
    expect(await setStaffRoleAction(null, form(member.id, 'root'))).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
