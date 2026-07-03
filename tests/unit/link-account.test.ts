/**
 * Unit test for the NextAuth events.linkAccount hook (src/lib/auth/config.ts):
 * a Google link must revoke any self-asserted password (anti-squatting); a
 * non-Google link must not touch the password.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authConfig } from '@/lib/auth/config';

const { updateSpy, setSpy, whereSpy } = vi.hoisted(() => {
  const whereSpy = vi.fn(async () => {});
  const setSpy = vi.fn(() => ({ where: whereSpy }));
  const updateSpy = vi.fn(() => ({ set: setSpy }));
  return { updateSpy, setSpy, whereSpy };
});

vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }));
vi.mock('@/lib/db', () => ({
  db: {
    update: updateSpy,
    query: { profiles: { findFirst: vi.fn() }, users: { findFirst: vi.fn() } },
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

const call = (provider: string) =>
  // @ts-expect-error minimal event args for the test
  authConfig.events!.linkAccount!({ user: { id: 'user-1' }, account: { provider } });

describe('events.linkAccount (anti-squatting)', () => {
  beforeEach(() => { updateSpy.mockClear(); setSpy.mockClear(); whereSpy.mockClear(); });

  it('clears passwordHash when a Google account links', async () => {
    await call('google');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({ passwordHash: null });
  });

  it('does nothing for a non-Google provider', async () => {
    await call('credentials');
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
