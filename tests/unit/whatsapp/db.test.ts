/**
 * Unit tests for whatsapp/db helpers.
 * Functions now use @/lib/db (Drizzle) directly — no client parameter.
 * We mock @/lib/db to avoid real DB connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @/lib/db ────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockSelectDistinctOn = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    selectDistinctOn: (...args: unknown[]) => mockSelectDistinctOn(...args),
  },
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  upsertConversation,
  insertMessage,
  findTenantByPhone,
  updateConversationActivity,
  incrementUnread,
  claimPendingInbound,
  finishClaimedInbound,
  hasPendingInbound,
  listHumanRepliesSince,
  listStalePendingConversations,
} from '@/lib/whatsapp/db';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sets up mockInsert to return a single row via .values().onConflictDoUpdate().returning() chain */
function setupInsertChain(rows: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  mockInsert.mockReturnValue(chain);
  return chain;
}

/** Sets up mockUpdate to return a basic chain */
function setupUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  mockUpdate.mockReturnValue(chain);
  return chain;
}

/** Sets up mockSelect to return rows via .from().where().limit() */
function setupSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mockSelect.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── upsertConversation ────────────────────────────────────────────────────────

describe('upsertConversation', () => {
  it('returns conversation id on success', async () => {
    setupInsertChain([{ id: 'conv-abc' }]);
    const id = await upsertConversation({
      orgId: 'org-1',
      externalPhone: '+15550001111',
      tenantId: 'tenant-1',
    });
    expect(id).toBe('conv-abc');
  });

  it('throws when data is null (missing id)', async () => {
    setupInsertChain([]);
    await expect(
      upsertConversation({ orgId: 'org-1', externalPhone: '+1', tenantId: null })
    ).rejects.toThrow('Failed to upsert conversation');
  });

  it('passes tenantId=null when omitted', async () => {
    setupInsertChain([{ id: 'conv-xyz' }]);
    const id = await upsertConversation({ orgId: 'org-1', externalPhone: '+1' });
    expect(id).toBe('conv-xyz');
  });
});

// ── insertMessage ─────────────────────────────────────────────────────────────

describe('insertMessage', () => {
  it('returns new message id on success', async () => {
    setupInsertChain([{ id: 'msg-999' }]);
    const result = await insertMessage({
      orgId: 'org-1',
      conversationId: 'conv-1',
      direction: 'inbound',
      body: 'Hello',
    });
    expect(result).toBe('msg-999');
  });

  it('returns null when no rows returned (duplicate — onConflictDoNothing)', async () => {
    setupInsertChain([]);
    const result = await insertMessage({
      orgId: 'org-1',
      conversationId: 'conv-1',
      direction: 'inbound',
      providerMessageId: 'dup-msg-id',
    });
    expect(result).toBeNull();
  });

  it('throws on DB error', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    mockInsert.mockReturnValue(chain);
    await expect(
      insertMessage({ orgId: 'org-1', conversationId: 'conv-1', direction: 'inbound' })
    ).rejects.toThrow('Failed to insert message');
  });

  it('accepts all optional fields', async () => {
    setupInsertChain([{ id: 'msg-100' }]);
    const result = await insertMessage({
      orgId: 'org-1',
      conversationId: 'conv-1',
      direction: 'outbound',
      providerMessageId: 'prov-123',
      body: 'Reminder',
      attachmentPath: 'orgs/org-1/img.jpg',
      attachmentKind: 'image',
      classification: 'receipt',
      status: 'sent',
      meta: { source: 'cron' },
      agentStatus: 'processed',
      senderKind: 'agent',
      sentByProfileId: 'profile-1',
    });
    expect(result).toBe('msg-100');
  });

  it('uses the plain (org_id, provider_message_id) unique index as the onConflictDoNothing arbiter, not a deferrable constraint', async () => {
    const chain = setupInsertChain([{ id: 'msg-101' }]);
    await insertMessage({ orgId: 'org-1', conversationId: 'conv-1', direction: 'inbound', providerMessageId: 'prov-abc' });
    expect(chain.onConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.any(Array) })
    );
  });
});

// ── claimPendingInbound / finishClaimedInbound / hasPendingInbound ───────────

describe('claimPendingInbound', () => {
  it('claims pending messages and returns them oldest first', async () => {
    const older = { id: 'msg-1', body: 'primero', attachmentKind: null, createdAt: new Date('2026-01-01T00:00:00Z') };
    const newer = { id: 'msg-2', body: 'segundo', attachmentKind: null, createdAt: new Date('2026-01-01T00:00:05Z') };
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([newer, older]), // out of order on purpose
    };
    mockUpdate.mockReturnValue(chain);

    const result = await claimPendingInbound('org-1', 'conv-1');
    expect(result.map((r) => r.id)).toEqual(['msg-1', 'msg-2']);
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ agentStatus: 'processing' }));
  });

  it('stamps agentClaimedAt (item 4) so a stale claim is later distinguishable from an in-flight one', async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    mockUpdate.mockReturnValue(chain);

    await claimPendingInbound('org-1', 'conv-1');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ agentClaimedAt: expect.any(Date) }));
  });
});

describe('finishClaimedInbound', () => {
  it('no-ops on an empty id list', async () => {
    await finishClaimedInbound([], 'processed');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('updates the given ids to the given status', async () => {
    const chain = setupUpdateChain();
    await finishClaimedInbound(['msg-1', 'msg-2'], 'pending');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ agentStatus: 'pending' }));
  });
});

describe('hasPendingInbound', () => {
  it('returns true when a pending row exists', async () => {
    setupSelectChain([{ id: 'msg-1' }]);
    expect(await hasPendingInbound('org-1', 'conv-1')).toBe(true);
  });

  it('returns false when none do', async () => {
    setupSelectChain([]);
    expect(await hasPendingInbound('org-1', 'conv-1')).toBe(false);
  });
});

describe('listHumanRepliesSince', () => {
  it('returns bodies of human-sent messages, filtering out nulls', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ body: 'Ya te escribo' }, { body: null }]),
    };
    mockSelect.mockReturnValue(chain);

    const result = await listHumanRepliesSince('org-1', 'conv-1', null);
    expect(result).toEqual(['Ya te escribo']);
  });
});

// ── findTenantByPhone ─────────────────────────────────────────────────────────

describe('findTenantByPhone', () => {
  it('returns tenant row when found', async () => {
    setupSelectChain([{ id: 'tenant-1', profileId: 'profile-1', preferredLanguage: 'es' }]);
    const result = await findTenantByPhone('org-1', '+15551112222');
    expect(result).toEqual({ id: 'tenant-1', profile_id: 'profile-1', preferred_language: 'es' });
  });

  it('returns null when not found', async () => {
    setupSelectChain([]);
    const result = await findTenantByPhone('org-1', '+15550000000');
    expect(result).toBeNull();
  });
});

// ── updateConversationActivity ────────────────────────────────────────────────

describe('updateConversationActivity', () => {
  it('calls db.update with lastMessageAt when flag is false', async () => {
    const chain = setupUpdateChain();
    await updateConversationActivity('conv-1', false);
    expect(mockUpdate).toHaveBeenCalledOnce();
    const setArg = chain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg).toHaveProperty('lastMessageAt');
    expect(setArg).not.toHaveProperty('unreadCountAdmin');
  });

  it('calls db.update with unreadCountAdmin increment when flag is true', async () => {
    const chain = setupUpdateChain();
    await updateConversationActivity('conv-1', true);
    expect(mockUpdate).toHaveBeenCalledOnce();
    const setArg = chain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg).toHaveProperty('lastMessageAt');
    expect(setArg).toHaveProperty('unreadCountAdmin');
  });
});

// ── incrementUnread ────────────────────────────────────────────────────────────

describe('incrementUnread', () => {
  it('calls db.update on whatsapp_conversations with unreadCountAdmin', async () => {
    setupUpdateChain();
    await incrementUnread('conv-uuid-42');
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

// ── listStalePendingConversations ─────────────────────────────────────────────

describe('listStalePendingConversations', () => {
  it('resurrects stale "processing" rows back to "pending" before selecting (item 4)', async () => {
    const resurrectChain = setupUpdateChain();
    mockSelectDistinctOn.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    await listStalePendingConversations(2 * 60 * 1000, 30 * 60 * 1000, 20);

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(resurrectChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ agentStatus: 'pending', agentClaimedAt: null })
    );
  });

  it('returns the distinct stale conversations after resurrecting', async () => {
    setupUpdateChain();
    const rows = [{ orgId: 'org-1', conversationId: 'conv-1' }];
    mockSelectDistinctOn.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    });

    const result = await listStalePendingConversations(2 * 60 * 1000, 30 * 60 * 1000, 20);
    expect(result).toEqual(rows);
  });
});
