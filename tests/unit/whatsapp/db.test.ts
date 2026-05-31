import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  upsertConversation,
  insertMessage,
  findTenantByPhone,
  updateConversationActivity,
  incrementUnread,
} from '@/lib/whatsapp/db';

// ── Shared mock factory ──────────────────────────────────────────────────────

function makeMockClient(overrides: Partial<{
  upsertResult: { data: unknown; error: unknown };
  insertResult: { data: unknown; error: unknown };
  selectResult: { data: unknown; error: unknown };
  rpcResult: { maybeSingle: () => Promise<void> };
  updateResult: { data: unknown; error: unknown };
}> = {}) {
  const defaults = {
    upsertResult:  { data: { id: 'conv-id-1' }, error: null },
    insertResult:  { data: { id: 'msg-id-1' }, error: null },
    selectResult:  { data: null, error: null },
    rpcResult:     { maybeSingle: vi.fn().mockResolvedValue(undefined) },
    updateResult:  { data: null, error: null },
  };
  const merged = { ...defaults, ...overrides };

  // Builder pattern: each method returns an object supporting .select(), .single(), etc.
  const builder = (result: { data: unknown; error: unknown }) => ({
    upsert: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    limit:  vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });

  const fromMap: Record<string, ReturnType<typeof builder>> = {};
  const getFrom = (table: string) => {
    if (!fromMap[table]) {
      if (table === 'whatsapp_conversations') {
        fromMap[table] = builder(merged.upsertResult);
      } else if (table === 'whatsapp_messages') {
        fromMap[table] = builder(merged.insertResult);
      } else {
        fromMap[table] = builder(merged.selectResult);
      }
    }
    return fromMap[table];
  };

  return {
    from: vi.fn().mockImplementation(getFrom),
    rpc:  vi.fn().mockReturnValue(merged.rpcResult),
  } as unknown as SupabaseClient;
}

// ── upsertConversation ────────────────────────────────────────────────────────

describe('upsertConversation', () => {
  it('returns conversation id on success', async () => {
    const client = makeMockClient({ upsertResult: { data: { id: 'conv-abc' }, error: null } });
    const id = await upsertConversation({
      adminClient: client,
      orgId: 'org-1',
      externalPhone: '+15550001111',
      tenantId: 'tenant-1',
    });
    expect(id).toBe('conv-abc');
    expect(client.from).toHaveBeenCalledWith('whatsapp_conversations');
  });

  it('throws when supabase returns an error', async () => {
    const client = makeMockClient({
      upsertResult: { data: null, error: { code: 'PGRST301', message: 'db error' } },
    });
    await expect(
      upsertConversation({ adminClient: client, orgId: 'org-1', externalPhone: '+1', tenantId: null })
    ).rejects.toThrow('Failed to upsert conversation');
  });

  it('throws when data is null (missing id)', async () => {
    const client = makeMockClient({ upsertResult: { data: null, error: null } });
    await expect(
      upsertConversation({ adminClient: client, orgId: 'org-1', externalPhone: '+1', tenantId: null })
    ).rejects.toThrow('Failed to upsert conversation');
  });

  it('passes tenantId=null when omitted', async () => {
    const client = makeMockClient({ upsertResult: { data: { id: 'conv-xyz' }, error: null } });
    const id = await upsertConversation({ adminClient: client, orgId: 'org-1', externalPhone: '+1' });
    expect(id).toBe('conv-xyz');
  });
});

// ── insertMessage ─────────────────────────────────────────────────────────────

describe('insertMessage', () => {
  it('returns new message id on success', async () => {
    const client = makeMockClient({ insertResult: { data: { id: 'msg-999' }, error: null } });
    const result = await insertMessage({
      adminClient: client,
      orgId: 'org-1',
      conversationId: 'conv-1',
      direction: 'inbound',
      body: 'Hello',
    });
    expect(result).toBe('msg-999');
  });

  it('returns null on 23505 duplicate (idempotent)', async () => {
    const client = makeMockClient({
      insertResult: { data: null, error: { code: '23505', message: 'unique violation' } },
    });
    const result = await insertMessage({
      adminClient: client,
      orgId: 'org-1',
      conversationId: 'conv-1',
      direction: 'inbound',
      providerMessageId: 'dup-msg-id',
    });
    expect(result).toBeNull();
  });

  it('throws on non-duplicate DB error', async () => {
    const client = makeMockClient({
      insertResult: { data: null, error: { code: 'PGRST500', message: 'internal error' } },
    });
    await expect(
      insertMessage({ adminClient: client, orgId: 'org-1', conversationId: 'conv-1', direction: 'inbound' })
    ).rejects.toThrow('Failed to insert message');
  });

  it('accepts all optional fields', async () => {
    const client = makeMockClient({ insertResult: { data: { id: 'msg-100' }, error: null } });
    const result = await insertMessage({
      adminClient: client,
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
    const tenantRow = { id: 'tenant-1', profile_id: 'profile-1', preferred_language: 'es' };
    const client = makeMockClient({ selectResult: { data: tenantRow, error: null } });
    const result = await findTenantByPhone(client, 'org-1', '+15551112222');
    expect(result).toEqual(tenantRow);
  });

  it('returns null when not found', async () => {
    const client = makeMockClient({ selectResult: { data: null, error: null } });
    const result = await findTenantByPhone(client, 'org-1', '+15550000000');
    expect(result).toBeNull();
  });
});

// ── updateConversationActivity ────────────────────────────────────────────────

describe('updateConversationActivity', () => {
  it('updates last_message_at without incrementing unread when flag is false', async () => {
    // Build a client that captures the update call
    const updateFn = vi.fn().mockReturnThis();
    const eqFn = vi.fn().mockResolvedValue({ data: null, error: null });

    const client = {
      from: vi.fn().mockReturnValue({
        update: updateFn,
        eq:     eqFn,
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { unread_count_admin: 3 }, error: null }),
      }),
    } as unknown as SupabaseClient;

    await updateConversationActivity(client, 'conv-1', false);
    expect(updateFn).toHaveBeenCalledOnce();
    // The update args should not include unread_count_admin
    const updateArg = updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).not.toHaveProperty('unread_count_admin');
    expect(updateArg).toHaveProperty('last_message_at');
  });

  it('increments unread when flag is true', async () => {
    const convData = { unread_count_admin: 2 };
    const updateFn = vi.fn().mockReturnThis();
    const eqFn2 = vi.fn().mockResolvedValue({ data: null, error: null });
    const singleFn = vi.fn().mockResolvedValue({ data: convData, error: null });
    const selectFn = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: singleFn }) });

    // The from() call returns a builder — update uses .update().eq(), select uses .select().eq().single()
    const builder = {
      update: updateFn,
      select: selectFn,
      eq:     eqFn2,
    };
    // For the update chain: update().eq() should resolve
    updateFn.mockReturnValue({ eq: eqFn2 });

    const client = {
      from: vi.fn().mockReturnValue(builder),
    } as unknown as SupabaseClient;

    await updateConversationActivity(client, 'conv-1', true);
    expect(updateFn).toHaveBeenCalledOnce();
    const updateArg = updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.unread_count_admin).toBe(3); // 2 + 1
  });
});

// ── incrementUnread ────────────────────────────────────────────────────────────

describe('incrementUnread', () => {
  it('calls rpc with conv_id param', async () => {
    const maybeSingleFn = vi.fn().mockResolvedValue(undefined);
    const rpcFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
    const client = { rpc: rpcFn } as unknown as SupabaseClient;

    await incrementUnread(client, 'conv-uuid-42');
    expect(rpcFn).toHaveBeenCalledWith('increment_wa_unread', { conv_id: 'conv-uuid-42' });
    expect(maybeSingleFn).toHaveBeenCalledOnce();
  });
});
