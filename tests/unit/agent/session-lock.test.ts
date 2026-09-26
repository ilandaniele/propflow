import { describe, it, expect, vi, beforeEach } from 'vitest';

const { updateWhereArgs, updateReturning, selectOrderByArgs, selectRows } = vi.hoisted(() => ({
  updateWhereArgs: [] as unknown[],
  updateReturning: [] as unknown[],
  selectOrderByArgs: [] as unknown[],
  selectRows: [] as unknown[],
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
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn((o: unknown) => {
        selectOrderByArgs.push(o);
        return { limit: vi.fn(async () => selectRows) };
      }),
    })),
  },
}));

import { isWindowOpen, tryAcquireSessionLock, releaseSessionLock, getSessionByConversation } from '@/lib/agent/session';

describe('agent/session — isWindowOpen (pure)', () => {
  it('open when windowExpiresAt is in the future', () => {
    expect(isWindowOpen({ windowExpiresAt: new Date(Date.now() + 60_000), lastInboundAt: null })).toBe(true);
  });

  it('closed when windowExpiresAt is in the past', () => {
    expect(isWindowOpen({ windowExpiresAt: new Date(Date.now() - 60_000), lastInboundAt: null })).toBe(false);
  });

  it('closed when both windowExpiresAt and lastInboundAt are null', () => {
    expect(isWindowOpen({ windowExpiresAt: null, lastInboundAt: null })).toBe(false);
  });

  it('honors an explicit `now`', () => {
    const expires = new Date('2026-01-01T00:00:00Z');
    expect(isWindowOpen({ windowExpiresAt: expires, lastInboundAt: null }, new Date('2025-12-31T00:00:00Z'))).toBe(true);
    expect(isWindowOpen({ windowExpiresAt: expires, lastInboundAt: null }, new Date('2026-01-02T00:00:00Z'))).toBe(false);
  });

  // Item 6: fallback derives the window from lastInboundAt when windowExpiresAt is null.
  it('falls back to lastInboundAt + 24h when windowExpiresAt is null', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const lastInboundAt = new Date('2026-01-01T00:00:00Z'); // 12h ago — within 24h
    expect(isWindowOpen({ windowExpiresAt: null, lastInboundAt }, now)).toBe(true);
  });

  it('the lastInboundAt fallback still closes once 24h have elapsed', () => {
    const now = new Date('2026-01-02T00:00:01Z');
    const lastInboundAt = new Date('2026-01-01T00:00:00Z'); // just over 24h ago
    expect(isWindowOpen({ windowExpiresAt: null, lastInboundAt }, now)).toBe(false);
  });

  it('windowExpiresAt wins over the lastInboundAt fallback when both are present', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const windowExpiresAt = new Date('2026-01-01T13:00:00Z'); // open
    const lastInboundAt = new Date('2025-01-01T00:00:00Z'); // would be closed on its own
    expect(isWindowOpen({ windowExpiresAt, lastInboundAt }, now)).toBe(true);
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

// Item 1: (org_id, channel, whatsapp_conversation_id) isn't a unique
// constraint, so without an explicit ORDER BY, a stray duplicate row (e.g.
// one a sweeper job used to create via a '' externalPhone placeholder) could
// be returned nondeterministically.
describe('agent/session — getSessionByConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectOrderByArgs.length = 0;
    selectRows.length = 0;
  });

  it('orders by created_at so the result is deterministic', async () => {
    selectRows.push({
      id: 'session-1', orgId: 'org-1', channel: 'whatsapp', externalId: '+51999999999',
      leadId: null, whatsappConversationId: 'conv-1', mode: 'ai', summary: null,
      agentTurnCount: 0, language: null, attribution: null, handoffReason: null,
      windowExpiresAt: null, lastAgentTurnAt: null, lastInboundAt: null,
    });

    const session = await getSessionByConversation('org-1', 'conv-1');

    expect(session?.id).toBe('session-1');
    expect(selectOrderByArgs).toHaveLength(1); // an ORDER BY clause was applied
  });

  it('returns null when no session matches', async () => {
    const session = await getSessionByConversation('org-1', 'conv-missing');
    expect(session).toBeNull();
  });
});
