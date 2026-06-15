import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { buildTenantActivityFeed, type ActivityEvent } from '@/lib/tenants/activity-feed';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Drizzle db stub that mocks the whatsapp_messages join query.
 * The Drizzle query chain is: select().from().innerJoin().where().orderBy().limit()
 */
function makeDbWithWaMessages(waMessages: unknown[]) {
  const chainable: Record<string, unknown> = {};
  // Final call in chain resolves with mock data
  chainable.limit   = vi.fn().mockResolvedValue(waMessages);
  chainable.orderBy = vi.fn().mockReturnValue(chainable);
  chainable.where   = vi.fn().mockReturnValue(chainable);
  chainable.innerJoin = vi.fn().mockReturnValue(chainable);
  chainable.from    = vi.fn().mockReturnValue(chainable);
  const selectFn    = vi.fn().mockReturnValue(chainable);

  return { select: selectFn } as unknown as PostgresJsDatabase;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildTenantActivityFeed', () => {
  it('returns empty array when no data exists in any table', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    expect(feed).toHaveLength(0);
  });

  it('includes payments in the feed', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [{ id: 'pay-1', amount: '500', status: 'approved', created_at: '2026-05-01T10:00:00Z' }],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    expect(feed.some(e => e.type === 'payment')).toBe(true);
    expect(feed.find(e => e.type === 'payment')?.label).toContain('500');
  });

  it('includes incidents in the feed', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [],
      incidents: [{ id: 'inc-1', title: 'Broken pipe', status: 'open', created_at: '2026-05-02T10:00:00Z' }],
      tasks: [],
      sanctions: [],
    });
    expect(feed.some(e => e.type === 'incident')).toBe(true);
    expect(feed.find(e => e.type === 'incident')?.label).toContain('Broken pipe');
  });

  it('includes tasks in the feed', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [],
      incidents: [],
      tasks: [{ id: 'task-1', title: 'Fix sink', status: 'pending', created_at: '2026-05-03T10:00:00Z' }],
      sanctions: [],
    });
    expect(feed.some(e => e.type === 'task')).toBe(true);
    expect(feed.find(e => e.type === 'task')?.label).toContain('Fix sink');
  });

  it('includes monetary sanctions with amount detail', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [{ id: 'sanc-1', title: 'Late fee', kind: 'monetary', amount: '200', status: 'approved', created_at: '2026-05-04T10:00:00Z' }],
    });
    const sanctionEvent = feed.find(e => e.type === 'sanction');
    expect(sanctionEvent).toBeDefined();
    expect(sanctionEvent?.detail).toContain('200');
  });

  it('includes warning sanctions with "Warning" detail', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [{ id: 'sanc-2', title: 'Noise complaint', kind: 'warning', amount: null, status: 'proposed', created_at: '2026-05-04T12:00:00Z' }],
    });
    const sanctionEvent = feed.find(e => e.type === 'sanction');
    expect(sanctionEvent?.detail).toBe('Warning');
  });

  it('includes whatsapp messages in the feed', async () => {
    const db = makeDbWithWaMessages([{
      id: 'msg-1',
      direction: 'inbound',
      classification: 'receipt',
      status: 'received',
      // Drizzle returns Date objects for timestamp columns
      createdAt: new Date('2026-05-05T10:00:00Z'),
    }]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    expect(feed.some(e => e.type === 'whatsapp')).toBe(true);
    const waEvent = feed.find(e => e.type === 'whatsapp');
    expect(waEvent?.label).toContain('Inbound');
    expect(waEvent?.detail).toBe('receipt');
  });

  it('sorts events by createdAt descending (newest first)', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [{ id: 'pay-1', amount: '100', status: 'approved', created_at: '2026-05-01T10:00:00Z' }],
      incidents: [],
      tasks: [{ id: 'task-1', title: 'Task A', status: 'pending', created_at: '2026-05-10T10:00:00Z' }],
      sanctions: [],
    });
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

    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments,
      incidents: [],
      tasks,
      sanctions: [],
    });
    expect(feed.length).toBeLessThanOrEqual(50);
  });

  it('handles empty arrays gracefully', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    expect(feed).toHaveLength(0);
  });

  it('sets id, type, label, createdAt on each event', async () => {
    const db = makeDbWithWaMessages([]);
    const feed = await buildTenantActivityFeed({
      db,
      tenantId: 'tenant-1',
      orgId: 'org-1',
      payments: [{ id: 'pay-abc', amount: '750', status: 'pending', created_at: '2026-06-01T08:00:00Z' }],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    expect(feed).toHaveLength(1);
    const item = feed[0];
    expect(item.id).toBe('pay-abc');
    expect(item.type).toBe('payment');
    expect(item.label).toContain('750');
    expect(item.createdAt).toBe('2026-06-01T08:00:00Z');
  });
});
