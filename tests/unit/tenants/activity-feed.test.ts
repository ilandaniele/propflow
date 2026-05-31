import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantActivityFeed, type ActivityEvent } from '@/lib/tenants/activity-feed';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(tableData: Record<string, unknown[]>) {
  // Each call to .from() returns a chainable builder that resolves with the stubbed data
  const createQueryBuilder = (data: unknown[]) => {
    const builder: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'order', 'limit'] as const;
    for (const method of methods) {
      builder[method] = vi.fn().mockReturnValue(builder);
    }
    // Terminal: resolve with the data array
    (builder as Record<string, unknown>).then = undefined; // not a thenable
    // simulate async resolution by returning an awaitable
    Object.defineProperty(builder, Symbol.toStringTag, { value: 'QueryBuilder' });

    // Override final call to return data:
    const last = vi.fn().mockResolvedValue({ data, error: null });
    // We need 'limit' to be the terminal awaitable
    (builder as Record<string, unknown>).limit = vi.fn().mockResolvedValue({ data, error: null });
    (builder as Record<string, unknown>).order = vi.fn().mockReturnValue(builder);
    (builder as Record<string, unknown>).eq = vi.fn().mockReturnValue(builder);
    (builder as Record<string, unknown>).select = vi.fn().mockReturnValue(builder);
    return builder;
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      const data = tableData[table] ?? [];
      return createQueryBuilder(data);
    }),
  } as unknown as SupabaseClient;
}

function event(
  id: string,
  type: ActivityEvent['type'],
  label: string,
  createdAt: string,
  extra: Partial<ActivityEvent> = {}
): unknown {
  return { id, type, label, status: 'active', created_at: createdAt, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getTenantActivityFeed', () => {
  it('returns empty array when no data exists in any table', async () => {
    const client = makeClient({
      payments: [],
      incidents: [],
      tenant_tasks: [],
      sanctions: [],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed).toHaveLength(0);
  });

  it('includes payments in the feed', async () => {
    const client = makeClient({
      payments: [{ id: 'pay-1', amount: '500', status: 'approved', created_at: '2026-05-01T10:00:00Z' }],
      incidents: [],
      tenant_tasks: [],
      sanctions: [],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed.some(e => e.type === 'payment')).toBe(true);
    expect(feed.find(e => e.type === 'payment')?.label).toContain('500');
  });

  it('includes incidents in the feed', async () => {
    const client = makeClient({
      payments: [],
      incidents: [{ id: 'inc-1', title: 'Broken pipe', status: 'open', created_at: '2026-05-02T10:00:00Z' }],
      tenant_tasks: [],
      sanctions: [],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed.some(e => e.type === 'incident')).toBe(true);
    expect(feed.find(e => e.type === 'incident')?.label).toContain('Broken pipe');
  });

  it('includes tasks in the feed', async () => {
    const client = makeClient({
      payments: [],
      incidents: [],
      tenant_tasks: [{ id: 'task-1', title: 'Fix sink', status: 'pending', created_at: '2026-05-03T10:00:00Z' }],
      sanctions: [],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed.some(e => e.type === 'task')).toBe(true);
    expect(feed.find(e => e.type === 'task')?.label).toContain('Fix sink');
  });

  it('includes monetary sanctions with amount detail', async () => {
    const client = makeClient({
      payments: [],
      incidents: [],
      tenant_tasks: [],
      sanctions: [{ id: 'sanc-1', title: 'Late fee', kind: 'monetary', amount: '200', status: 'approved', created_at: '2026-05-04T10:00:00Z' }],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    const sanctionEvent = feed.find(e => e.type === 'sanction');
    expect(sanctionEvent).toBeDefined();
    expect(sanctionEvent?.detail).toContain('200');
  });

  it('includes warning sanctions with "Warning" detail', async () => {
    const client = makeClient({
      payments: [],
      incidents: [],
      tenant_tasks: [],
      sanctions: [{ id: 'sanc-2', title: 'Noise complaint', kind: 'warning', amount: null, status: 'proposed', created_at: '2026-05-04T12:00:00Z' }],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    const sanctionEvent = feed.find(e => e.type === 'sanction');
    expect(sanctionEvent?.detail).toBe('Warning');
  });

  it('includes whatsapp messages in the feed', async () => {
    const client = makeClient({
      payments: [],
      incidents: [],
      tenant_tasks: [],
      sanctions: [],
      whatsapp_messages: [{
        id: 'msg-1',
        direction: 'inbound',
        classification: 'receipt',
        status: 'received',
        created_at: '2026-05-05T10:00:00Z',
        conversation: { tenant_id: 'tenant-1' },
      }],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed.some(e => e.type === 'whatsapp')).toBe(true);
    const waEvent = feed.find(e => e.type === 'whatsapp');
    expect(waEvent?.label).toContain('Inbound');
    expect(waEvent?.detail).toBe('receipt');
  });

  it('sorts events by createdAt descending (newest first)', async () => {
    const client = makeClient({
      payments: [{ id: 'pay-1', amount: '100', status: 'approved', created_at: '2026-05-01T10:00:00Z' }],
      incidents: [],
      tenant_tasks: [{ id: 'task-1', title: 'Task A', status: 'pending', created_at: '2026-05-10T10:00:00Z' }],
      sanctions: [],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    // task (May 10) should come before payment (May 1)
    const taskIdx = feed.findIndex(e => e.type === 'task');
    const payIdx = feed.findIndex(e => e.type === 'payment');
    expect(taskIdx).toBeLessThan(payIdx);
  });

  it('caps results at 50 events', async () => {
    // Create 30 payments + 30 tasks = 60 total → should be capped at 50
    const payments = Array.from({ length: 30 }, (_, i) => ({
      id: `pay-${i}`,
      amount: '100',
      status: 'approved',
      created_at: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
    const tasks = Array.from({ length: 30 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      status: 'pending',
      created_at: `2026-04-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));

    const client = makeClient({
      payments,
      incidents: [],
      tenant_tasks: tasks,
      sanctions: [],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed.length).toBeLessThanOrEqual(50);
  });

  it('handles null data from supabase gracefully (treats as empty array)', async () => {
    // All tables return null data
    const queryBuilder: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'order'] as const;
    for (const method of methods) {
      queryBuilder[method] = vi.fn().mockReturnValue(queryBuilder);
    }
    queryBuilder.limit = vi.fn().mockResolvedValue({ data: null, error: null });

    const client = {
      from: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as SupabaseClient;

    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed).toHaveLength(0);
  });

  it('sets id, type, label, createdAt on each event', async () => {
    const client = makeClient({
      payments: [{ id: 'pay-abc', amount: '750', status: 'pending', created_at: '2026-06-01T08:00:00Z' }],
      incidents: [],
      tenant_tasks: [],
      sanctions: [],
      whatsapp_messages: [],
    });
    const feed = await getTenantActivityFeed(client, 'tenant-1', 'org-1');
    expect(feed).toHaveLength(1);
    const item = feed[0];
    expect(item.id).toBe('pay-abc');
    expect(item.type).toBe('payment');
    expect(item.label).toContain('750');
    expect(item.createdAt).toBe('2026-06-01T08:00:00Z');
  });
});
