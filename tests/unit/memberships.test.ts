import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined, throws: false }));
const findMembership = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  cookies: async () => {
    if (cookieValue.throws) throw new Error('outside request scope');
    return { get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) };
  },
}));
vi.mock('@/lib/memberships/queries', () => ({ findMembership }));

const home = { id: 'p1', org_id: 'home-org', role: 'admin' as const, full_name: 'Ana' };

describe('resolveActiveOrg', () => {
  beforeEach(() => {
    cookieValue.current = undefined;
    cookieValue.throws = false;
    findMembership.mockReset();
  });

  it('keeps the home org when no cookie is set or cookies are unavailable', async () => {
    const { resolveActiveOrg } = await import('@/lib/memberships/active-org');
    expect(await resolveActiveOrg('u1', home)).toBe(home);
    cookieValue.throws = true;
    expect(await resolveActiveOrg('u1', home)).toBe(home);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('skips the lookup when the cookie points at the home org', async () => {
    const { resolveActiveOrg } = await import('@/lib/memberships/active-org');
    cookieValue.current = 'home-org';
    expect(await resolveActiveOrg('u1', home)).toBe(home);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('switches org and role when the user is a member', async () => {
    const { resolveActiveOrg } = await import('@/lib/memberships/active-org');
    cookieValue.current = 'other-org';
    findMembership.mockResolvedValue({ orgId: 'other-org', role: 'tenant' });
    expect(await resolveActiveOrg('u1', home)).toEqual({ ...home, org_id: 'other-org', role: 'tenant' });
    expect(findMembership).toHaveBeenCalledWith('u1', 'other-org');
  });

  it('ignores a cookie for an org the user does not belong to', async () => {
    const { resolveActiveOrg } = await import('@/lib/memberships/active-org');
    cookieValue.current = 'foreign-org';
    findMembership.mockResolvedValue(null);
    expect(await resolveActiveOrg('u1', home)).toBe(home);
  });
});

describe('membership schemas', () => {
  it('normalizes email and restricts roles', async () => {
    const { AddMemberSchema, RemoveMemberSchema } = await import('@/lib/memberships/schemas');
    expect(AddMemberSchema.parse({ email: ' Ana@Example.COM ', role: 'tenant' })).toEqual({ email: 'ana@example.com', role: 'tenant' });
    expect(AddMemberSchema.safeParse({ email: 'ana@example.com', role: 'owner' }).success).toBe(false);
    expect(AddMemberSchema.safeParse({ email: 'nope', role: 'admin' }).success).toBe(false);
    expect(RemoveMemberSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});
