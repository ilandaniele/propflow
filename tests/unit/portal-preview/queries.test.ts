/**
 * Unit tests: src/lib/portal-preview/queries.ts
 *
 * Tests verify that each helper:
 *   AC7: getPortalPreviewVisitors — uses .eq('host_tenant_id', tenantId) + .eq('org_id', orgId);
 *        B3: VISITORS_LIMIT=50
 *   AC8: getPortalPreviewNotifications — uses .eq('profile_id', profileId) + .eq('org_id', orgId);
 *        returns [] immediately when profileId is null (no DB call); B3: NOTIFICATIONS_LIMIT=100
 *   AC9: getPortalPreviewAnnouncements — applies audience filter + published/non-expired filters;
 *        B3: ANNOUNCEMENTS_LIMIT=50
 *   AC10: getPortalPreviewAISessions — returns [] when profileId is null; calls groupAISessions
 *   B2: getPortalPreviewRecentPayments — limit 3, scoped to tenant_id + org_id
 *   B2: getPortalPreviewRecentIncidents — limit 3, scoped to tenant_id + org_id
 *
 * Strategy: build a tracked Supabase client stub that records every method call
 * and the arguments it received. The terminal .limit() call returns the configured data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPortalPreviewVisitors,
  getPortalPreviewNotifications,
  getPortalPreviewAnnouncements,
  getPortalPreviewAISessions,
  getPortalPreviewRecentPayments,
  getPortalPreviewRecentIncidents,
} from '@/lib/portal-preview/queries';

// ---------------------------------------------------------------------------
// Query builder stub — records calls and returns controlled data at .limit()
// ---------------------------------------------------------------------------

interface CallRecord {
  method: string;
  args: unknown[];
}

interface QueryBuilderConfig {
  data: unknown[];
  error: { code: string } | null;
}

function makeQueryBuilder(config: QueryBuilderConfig) {
  const calls: CallRecord[] = [];
  let capturedLimit: number | null = null;

  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };

  const builder: Record<string, unknown> & {
    _calls: CallRecord[];
    _limit: () => number | null;
    limit: (n: number) => Promise<{ data: unknown[]; error: { code: string } | null }>;
  } = {
    _calls: calls,
    _limit: () => capturedLimit,
    select: vi.fn((...args) => record('select', ...args)),
    eq: vi.fn((...args) => record('eq', ...args)),
    order: vi.fn((...args) => record('order', ...args)),
    not: vi.fn((...args) => record('not', ...args)),
    lte: vi.fn((...args) => record('lte', ...args)),
    or: vi.fn((...args) => record('or', ...args)),
    limit: vi.fn(async (n: number) => {
      capturedLimit = n;
      return { data: config.data, error: config.error };
    }),
  };

  return builder;
}

function makeSupabaseClient(config: QueryBuilderConfig) {
  let latestBuilder: ReturnType<typeof makeQueryBuilder>;

  const client = {
    from: vi.fn((_table: string) => {
      latestBuilder = makeQueryBuilder(config);
      return latestBuilder;
    }),
    _getLatestBuilder: () => latestBuilder,
    _getLatestLimit: () => latestBuilder?._limit() ?? null,
  };

  return client as unknown as SupabaseClient & {
    _getLatestBuilder: () => ReturnType<typeof makeQueryBuilder>;
    _getLatestLimit: () => number | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers to inspect recorded calls
// ---------------------------------------------------------------------------

function getEqCalls(calls: CallRecord[]) {
  return calls.filter(c => c.method === 'eq');
}

function hasEq(calls: CallRecord[], column: string, value: unknown) {
  return getEqCalls(calls).some(c => c.args[0] === column && c.args[1] === value);
}

function getOrCalls(calls: CallRecord[]) {
  return calls.filter(c => c.method === 'or');
}

// ---------------------------------------------------------------------------
// AC7: getPortalPreviewVisitors
// ---------------------------------------------------------------------------

describe('getPortalPreviewVisitors (AC7)', () => {
  const tenantId = 'tenant-uuid-123';
  const orgId = 'org-uuid-abc';

  it('queries visitor_logs table', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewVisitors(client, tenantId, orgId);
    expect(client.from).toHaveBeenCalledWith('visitor_logs');
  });

  it('filters by host_tenant_id (AC7)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewVisitors(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'host_tenant_id', tenantId)).toBe(true);
  });

  it('filters by org_id (defense-in-depth, AC7)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewVisitors(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('applies both host_tenant_id AND org_id filters (AC7 — gap fix)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewVisitors(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'host_tenant_id', tenantId)).toBe(true);
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('returns mapped visitor rows', async () => {
    const rows = [
      {
        id: 'v1',
        visitor_name: 'Alice',
        purpose: 'visit',
        visit_date: '2026-06-01',
        entry_time: '2026-06-01T10:00:00Z',
        exit_time: null,
        host_tenant_id: tenantId,
        unit_id: 'unit-1',
        org_id: orgId,
      },
    ];
    const client = makeSupabaseClient({ data: rows, error: null });
    const result = await getPortalPreviewVisitors(client, tenantId, orgId);
    expect(result).toHaveLength(1);
    expect(result[0].visitor_name).toBe('Alice');
  });

  it('returns empty array on query error (no throw)', async () => {
    const client = makeSupabaseClient({ data: [], error: { code: 'PGRST116' } });
    const result = await getPortalPreviewVisitors(client, tenantId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    const client = makeSupabaseClient({ data: null as unknown as unknown[], error: null });
    const result = await getPortalPreviewVisitors(client, tenantId, orgId);
    expect(result).toEqual([]);
  });

  it('uses VISITORS_LIMIT=50 (B3 — spec row limit)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewVisitors(client, tenantId, orgId);
    expect(client._getLatestLimit()).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// AC8: getPortalPreviewNotifications
// ---------------------------------------------------------------------------

describe('getPortalPreviewNotifications (AC8)', () => {
  const profileId = 'profile-uuid-456';
  const orgId = 'org-uuid-abc';

  it('returns [] immediately when profileId is null — NO DB call (IC5)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    const result = await getPortalPreviewNotifications(client, null, orgId);
    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('queries notification_inbox table when profileId is present', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewNotifications(client, profileId, orgId);
    expect(client.from).toHaveBeenCalledWith('notification_inbox');
  });

  it('filters by profile_id (AC8)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewNotifications(client, profileId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'profile_id', profileId)).toBe(true);
  });

  it('filters by org_id (defense-in-depth, AC8)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewNotifications(client, profileId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('applies both profile_id AND org_id filters (AC8 — gap fix)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewNotifications(client, profileId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'profile_id', profileId)).toBe(true);
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('orders by created_at DESC (matches /portal/notifications)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewNotifications(client, profileId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orderCall = calls.find(c => c.method === 'order');
    expect(orderCall).toBeDefined();
    expect(orderCall?.args[0]).toBe('created_at');
    expect((orderCall?.args[1] as { ascending: boolean })?.ascending).toBe(false);
  });

  it('returns notification rows', async () => {
    const rows = [
      {
        id: 'n1',
        title: 'Payment due',
        body: 'Your rent is due tomorrow.',
        created_at: '2026-06-01T09:00:00Z',
        read_at: null,
        profile_id: profileId,
        org_id: orgId,
      },
    ];
    const client = makeSupabaseClient({ data: rows, error: null });
    const result = await getPortalPreviewNotifications(client, profileId, orgId);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Payment due');
  });

  it('returns empty array on query error (no throw)', async () => {
    const client = makeSupabaseClient({ data: [], error: { code: '42501' } });
    const result = await getPortalPreviewNotifications(client, profileId, orgId);
    expect(result).toEqual([]);
  });

  it('uses NOTIFICATIONS_LIMIT=100 (B3 — spec row limit)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewNotifications(client, profileId, orgId);
    expect(client._getLatestLimit()).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// AC9: getPortalPreviewAnnouncements
// ---------------------------------------------------------------------------

describe('getPortalPreviewAnnouncements (AC9)', () => {
  const orgId = 'org-uuid-abc';
  const unitId = 'unit-uuid-789';
  const propertyId = 'property-uuid-321';

  it('queries announcements table', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    expect(client.from).toHaveBeenCalledWith('announcements');
  });

  it('filters by org_id (defense-in-depth, AC9)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('excludes rows with null published_at (unpublished)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const notCall = calls.find(c => c.method === 'not');
    expect(notCall).toBeDefined();
    expect(notCall?.args[0]).toBe('published_at');
    expect(notCall?.args[1]).toBe('is');
    expect(notCall?.args[2]).toBeNull();
  });

  it('applies lte filter for published_at <= now (published check)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const lteCall = calls.find(c => c.method === 'lte');
    expect(lteCall).toBeDefined();
    expect(lteCall?.args[0]).toBe('published_at');
  });

  it('applies or() filter for expires_at (null or future)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orCalls = getOrCalls(calls);
    // At least one .or() call covers the expires_at condition
    const expiresOrCall = orCalls.find(c => {
      const arg = String(c.args[0]);
      return arg.includes('expires_at');
    });
    expect(expiresOrCall).toBeDefined();
  });

  it('applies or() filter containing audience=all (AC9)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orCalls = getOrCalls(calls);
    const audienceOrCall = orCalls.find(c => {
      const arg = String(c.args[0]);
      return arg.includes('audience.eq.all');
    });
    expect(audienceOrCall).toBeDefined();
  });

  it('includes unit audience filter when tenantUnitId is provided (AC9)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orCalls = getOrCalls(calls);
    const audienceOrCall = orCalls.find(c => {
      const arg = String(c.args[0]);
      return arg.includes('audience.eq.all');
    });
    expect(String(audienceOrCall?.args[0])).toContain(unitId);
  });

  it('includes property audience filter when tenantPropertyId is provided (AC9)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orCalls = getOrCalls(calls);
    const audienceOrCall = orCalls.find(c => {
      const arg = String(c.args[0]);
      return arg.includes('audience.eq.all');
    });
    expect(String(audienceOrCall?.args[0])).toContain(propertyId);
  });

  it('only applies audience=all when both unit and property are null', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, null, null, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orCalls = getOrCalls(calls);
    const audienceOrCall = orCalls.find(c => String(c.args[0]).includes('audience.eq.all'));
    // Should only contain 'audience.eq.all' — no unit/property parts
    expect(String(audienceOrCall?.args[0])).toBe('audience.eq.all');
  });

  it('returns announcement rows', async () => {
    const rows = [
      {
        id: 'ann-1',
        title: 'Maintenance',
        body: 'Water will be cut off Sunday.',
        audience: 'all',
        published_at: '2026-06-01T08:00:00Z',
        expires_at: null,
        unit_id: null,
        property_id: null,
        org_id: orgId,
      },
    ];
    const client = makeSupabaseClient({ data: rows, error: null });
    const result = await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Maintenance');
  });

  it('returns empty array on query error (no throw)', async () => {
    const client = makeSupabaseClient({ data: [], error: { code: 'PGRST200' } });
    const result = await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    expect(result).toEqual([]);
  });

  it('uses ANNOUNCEMENTS_LIMIT=50 (B3 — spec row limit)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAnnouncements(client, unitId, propertyId, orgId);
    expect(client._getLatestLimit()).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// AC10: getPortalPreviewAISessions
// ---------------------------------------------------------------------------

describe('getPortalPreviewAISessions (AC10)', () => {
  const profileId = 'profile-uuid-456';
  const orgId = 'org-uuid-abc';

  it('returns [] immediately when profileId is null — NO DB call (IC5)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    const result = await getPortalPreviewAISessions(client, null, orgId);
    expect(result).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('queries ai_chat_messages table when profileId is present', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAISessions(client, profileId, orgId);
    expect(client.from).toHaveBeenCalledWith('ai_chat_messages');
  });

  it('filters by profile_id (AC10)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAISessions(client, profileId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'profile_id', profileId)).toBe(true);
  });

  it('filters by org_id (defense-in-depth, AC10)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewAISessions(client, profileId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('passes messages to groupAISessions and returns grouped AISession[]', async () => {
    const sessionId1 = 'session-aaa-111';
    const sessionId2 = 'session-bbb-222';
    const messages = [
      { id: 'm1', session_id: sessionId1, role: 'user', content: 'Hello', created_at: '2026-06-01T10:00:00Z', profile_id: profileId, org_id: orgId },
      { id: 'm2', session_id: sessionId1, role: 'assistant', content: 'Hi there', created_at: '2026-06-01T10:01:00Z', profile_id: profileId, org_id: orgId },
      { id: 'm3', session_id: sessionId2, role: 'user', content: 'What is my balance?', created_at: '2026-06-02T09:00:00Z', profile_id: profileId, org_id: orgId },
    ];

    const client = makeSupabaseClient({ data: messages, error: null });
    const result = await getPortalPreviewAISessions(client, profileId, orgId);

    expect(result).toHaveLength(2);
    // Sorted by started_at DESC — session2 (June 2) first
    expect(result[0].session_id).toBe(sessionId2);
    expect(result[0].message_count).toBe(1);
    expect(result[1].session_id).toBe(sessionId1);
    expect(result[1].message_count).toBe(2);
  });

  it('returns empty array on query error (no throw)', async () => {
    const client = makeSupabaseClient({ data: [], error: { code: '42501' } });
    const result = await getPortalPreviewAISessions(client, profileId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array when no messages exist', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    const result = await getPortalPreviewAISessions(client, profileId, orgId);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B2: getPortalPreviewRecentPayments
// ---------------------------------------------------------------------------

describe('getPortalPreviewRecentPayments (B2)', () => {
  const tenantId = 'tenant-uuid-123';
  const orgId = 'org-uuid-abc';

  it('queries the payments table', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentPayments(client, tenantId, orgId);
    expect(client.from).toHaveBeenCalledWith('payments');
  });

  it('filters by tenant_id', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentPayments(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'tenant_id', tenantId)).toBe(true);
  });

  it('filters by org_id (defense-in-depth)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentPayments(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('applies both tenant_id AND org_id filters', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentPayments(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'tenant_id', tenantId)).toBe(true);
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('orders by paid_at DESC', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentPayments(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orderCall = calls.find(c => c.method === 'order');
    expect(orderCall).toBeDefined();
    expect(orderCall?.args[0]).toBe('paid_at');
    expect((orderCall?.args[1] as { ascending: boolean })?.ascending).toBe(false);
  });

  it('limits to 3 rows (B2 — 3 most recent)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentPayments(client, tenantId, orgId);
    expect(client._getLatestLimit()).toBe(3);
  });

  it('returns payment rows with expected fields', async () => {
    const rows = [
      {
        id: 'pay-1',
        amount: 1200,
        paid_at: '2026-06-01T10:00:00Z',
        status: 'approved',
        method: 'bank_transfer',
      },
      {
        id: 'pay-2',
        amount: 1200,
        paid_at: '2026-05-01T10:00:00Z',
        status: 'approved',
        method: 'cash',
      },
    ];
    const client = makeSupabaseClient({ data: rows, error: null });
    const result = await getPortalPreviewRecentPayments(client, tenantId, orgId);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('pay-1');
    expect(result[0].amount).toBe(1200);
    expect(result[0].status).toBe('approved');
  });

  it('returns empty array on query error (no throw)', async () => {
    const client = makeSupabaseClient({ data: [], error: { code: 'PGRST116' } });
    const result = await getPortalPreviewRecentPayments(client, tenantId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    const client = makeSupabaseClient({ data: null as unknown as unknown[], error: null });
    const result = await getPortalPreviewRecentPayments(client, tenantId, orgId);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B2: getPortalPreviewRecentIncidents
// ---------------------------------------------------------------------------

describe('getPortalPreviewRecentIncidents (B2)', () => {
  const tenantId = 'tenant-uuid-123';
  const orgId = 'org-uuid-abc';

  it('queries the incidents table', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    expect(client.from).toHaveBeenCalledWith('incidents');
  });

  it('filters by tenant_id', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'tenant_id', tenantId)).toBe(true);
  });

  it('filters by org_id (defense-in-depth)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('applies both tenant_id AND org_id filters', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    expect(hasEq(calls, 'tenant_id', tenantId)).toBe(true);
    expect(hasEq(calls, 'org_id', orgId)).toBe(true);
  });

  it('orders by created_at DESC', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    const calls = client._getLatestBuilder()._calls;
    const orderCall = calls.find(c => c.method === 'order');
    expect(orderCall).toBeDefined();
    expect(orderCall?.args[0]).toBe('created_at');
    expect((orderCall?.args[1] as { ascending: boolean })?.ascending).toBe(false);
  });

  it('limits to 3 rows (B2 — 3 most recent)', async () => {
    const client = makeSupabaseClient({ data: [], error: null });
    await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    expect(client._getLatestLimit()).toBe(3);
  });

  it('returns incident rows with expected fields', async () => {
    const rows = [
      {
        id: 'inc-1',
        title: 'Water leak in bathroom',
        status: 'open',
        created_at: '2026-06-01T08:00:00Z',
      },
      {
        id: 'inc-2',
        title: 'Broken window',
        status: 'resolved',
        created_at: '2026-05-20T09:00:00Z',
      },
    ];
    const client = makeSupabaseClient({ data: rows, error: null });
    const result = await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('inc-1');
    expect(result[0].title).toBe('Water leak in bathroom');
    expect(result[0].status).toBe('open');
  });

  it('returns empty array on query error (no throw)', async () => {
    const client = makeSupabaseClient({ data: [], error: { code: 'PGRST116' } });
    const result = await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    const client = makeSupabaseClient({ data: null as unknown as unknown[], error: null });
    const result = await getPortalPreviewRecentIncidents(client, tenantId, orgId);
    expect(result).toEqual([]);
  });
});
