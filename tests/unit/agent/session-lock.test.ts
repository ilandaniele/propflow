import { describe, it, expect, vi, beforeEach } from 'vitest';

const { updateWhereArgs, updateReturning } = vi.hoisted(() => ({
  updateWhereArgs: [] as unknown[],
  updateReturning: [] as unknown[],
}));

vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((w: unknown) => {
          updateWhereArgs.push(w);
          return { returning: vi.fn(async () => updateReturning) };
        }),
      })),
    })),
  },
}));

import { isWindowOpen, tryAcquireSessionLock, releaseSessionLock } from '@/lib/agent/session';

describe('agent/session — isWindowOpen (pure)', () => {
  it('open when windowExpiresAt is in the future', () => {
    expect(isWindowOpen({ windowExpiresAt: new Date(Date.now() + 60_000) })).toBe(true);
  });

  it('closed when windowExpiresAt is in the past', () => {
    expect(isWindowOpen({ windowExpiresAt: new Date(Date.now() - 60_000) })).toBe(false);
  });

  it('closed when windowExpiresAt is null', () => {
    expect(isWindowOpen({ windowExpiresAt: null })).toBe(false);
  });

  it('honors an explicit `now`', () => {
    const expires = new Date('2026-01-01T00:00:00Z');
    expect(isWindowOpen({ windowExpiresAt: expires }, new Date('2025-12-31T00:00:00Z'))).toBe(true);
    expect(isWindowOpen({ windowExpiresAt: expires }, new Date('2026-01-02T00:00:00Z'))).toBe(false);
  });
});

describe('agent/session — tryAcquireSessionLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereArgs.length = 0;
    updateReturning.length = 0;
  });

  it('returns true and builds a conditional (unheld OR expired) update when it acquires the lock', async () => {
    updateReturning.push({ id: 'session-1' });
    const acquired = await tryAcquireSessionLock('session-1');
    expect(acquired).toBe(true);
    expect(updateWhereArgs).toHaveLength(1); // the WHERE clause combines id + (lock IS NULL OR lock < now())
  });

  it('returns false when the lock is busy (no row returned)', async () => {
    updateReturning.length = 0;
    const acquired = await tryAcquireSessionLock('session-1');
    expect(acquired).toBe(false);
  });

  it('releaseSessionLock clears the lock column without throwing', async () => {
    await releaseSessionLock('session-1');
    expect(updateWhereArgs).toHaveLength(1);
  });
});
