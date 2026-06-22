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

vi.mock('@/lib/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
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
    });
    expect(result).toBe('msg-100');
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
