/**
 * tests/unit/activity-feed-builder.test.ts
 *
 * AC3 — Unit tests for the in-memory activity-feed builder (Drizzle version).
 * The function uses @/lib/db directly — we mock it to control the WA messages query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildTenantActivityFeed,
  type PaymentRow,
  type IncidentRow,
  type TaskRow,
  type SanctionRow,
} from '@/lib/tenants/activity-feed';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-fixture-1';
const ORG_ID = 'org-fixture-1';

const FIXTURE_PAYMENTS: PaymentRow[] = [
  { id: 'pay-a', amount: 1500, status: 'approved', created_at: '2026-05-20T08:00:00Z' },
  { id: 'pay-b', amount: 750,  status: 'pending',  created_at: '2026-04-15T12:00:00Z' },
];

const FIXTURE_INCIDENTS: IncidentRow[] = [
  { id: 'inc-a', title: 'Leaking roof',  status: 'open',       created_at: '2026-05-18T09:00:00Z' },
  { id: 'inc-b', title: 'Broken window', status: 'in_progress', created_at: '2026-03-10T07:30:00Z' },
];

const FIXTURE_TASKS: TaskRow[] = [
  { id: 'task-a', title: 'Submit lease renewal',  status: 'pending',   created_at: '2026-05-25T10:00:00Z' },
  { id: 'task-b', title: 'Replace smoke detector', status: 'completed', created_at: '2026-02-01T14:00:00Z' },
];

const FIXTURE_SANCTIONS: SanctionRow[] = [
  { id: 'sanc-a', title: 'Late payment fee', kind: 'monetary', amount: 300,  status: 'approved', created_at: '2026-05-10T11:00:00Z' },
  { id: 'sanc-b', title: 'Noise violation',  kind: 'warning',  amount: null, status: 'proposed', created_at: '2026-01-05T16:00:00Z' },
];

// Drizzle returns camelCase + Date objects for timestamps
const FIXTURE_WA_MESSAGES = [
  {
    id: 'msg-a',
    direction: 'inbound',
    classification: 'payment_proof',
    status: 'received',
    createdAt: new Date('2026-05-22T15:00:00Z'),
  },
  {
    id: 'msg-b',
    direction: 'outbound',
    classification: null,
    status: 'sent',
    createdAt: new Date('2026-04-30T09:30:00Z'),
  },
];

// ── Mock @/lib/db ──────────────────────────────────────────────────────────────

let mockWaMessages: unknown[] = [];
const mockDbSelect = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

function setupDbSelectChain(messages: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(messages),
  };
  mockDbSelect.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWaMessages = [];
  setupDbSelectChain(mockWaMessages);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('buildTenantActivityFeed — in-memory builder (AC3)', () => {
  it('(d) accepts all-empty arrays and returns an empty timeline', async () => {
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    expect(feed).toHaveLength(0);
  });

  it('(b) maps payments to ActivityEvent with type="payment"', async () => {
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: FIXTURE_PAYMENTS,
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    const paymentEvents = feed.filter(e => e.type === 'payment');
    expect(paymentEvents).toHaveLength(2);
    expect(paymentEvents[0].id).toBe('pay-a');
    expect(paymentEvents[0].label).toBe('Payment — $1,500');
    expect(paymentEvents[0].status).toBe('approved');
    expect(paymentEvents[0].createdAt).toBe('2026-05-20T08:00:00Z');
  });

  it('maps incidents to ActivityEvent with type="incident"', async () => {
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: [],
      incidents: FIXTURE_INCIDENTS,
      tasks: [],
      sanctions: [],
    });
    const incidentEvents = feed.filter(e => e.type === 'incident');
    expect(incidentEvents).toHaveLength(2);
    expect(incidentEvents[0].label).toBe('Incident — Leaking roof');
  });

  it('maps tasks to ActivityEvent with type="task"', async () => {
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: [],
      incidents: [],
      tasks: FIXTURE_TASKS,
      sanctions: [],
    });
    const taskEvents = feed.filter(e => e.type === 'task');
    expect(taskEvents).toHaveLength(2);
    expect(taskEvents[0].label).toBe('Task — Submit lease renewal');
  });

  it('maps monetary sanctions with formatted amount as detail', async () => {
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: FIXTURE_SANCTIONS,
    });
    const sanctionEvents = feed.filter(e => e.type === 'sanction');
    expect(sanctionEvents).toHaveLength(2);

    const monetary = sanctionEvents.find(e => e.id === 'sanc-a');
    expect(monetary?.detail).toBe('$300');

    const warning = sanctionEvents.find(e => e.id === 'sanc-b');
    expect(warning?.detail).toBe('Warning');
  });

  it('(c) still issues a whatsapp_messages DB query (only remaining DB call)', async () => {
    setupDbSelectChain(FIXTURE_WA_MESSAGES);
    await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    // db.select was called once for the WA messages join
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
  });

  it('does NOT query payments, incidents, tenant_tasks, or sanctions from DB', async () => {
    setupDbSelectChain([]);
    await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: FIXTURE_PAYMENTS,
      incidents: FIXTURE_INCIDENTS,
      tasks: FIXTURE_TASKS,
      sanctions: FIXTURE_SANCTIONS,
    });
    // db.select called only once (for whatsapp_messages)
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
  });

  it('(a) sorts all event types by createdAt descending (newest first)', async () => {
    setupDbSelectChain(FIXTURE_WA_MESSAGES);
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: FIXTURE_PAYMENTS,
      incidents: FIXTURE_INCIDENTS,
      tasks: FIXTURE_TASKS,
      sanctions: FIXTURE_SANCTIONS,
    });

    // Verify descending order
    for (let i = 1; i < feed.length; i++) {
      const prev = new Date(feed[i - 1].createdAt).getTime();
      const curr = new Date(feed[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }

    // Verify the very first event is the task from 2026-05-25
    expect(feed[0].id).toBe('task-a');
    expect(feed[0].type).toBe('task');
  });

  it('(a) timeline snapshot — shape is identical to pre-refactor output for same inputs', async () => {
    setupDbSelectChain(FIXTURE_WA_MESSAGES);
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: FIXTURE_PAYMENTS,
      incidents: FIXTURE_INCIDENTS,
      tasks: FIXTURE_TASKS,
      sanctions: FIXTURE_SANCTIONS,
    });

    const snapshot = feed.map(e => ({
      id: e.id,
      type: e.type,
      label: e.label,
      createdAt: e.createdAt,
    }));

    expect(snapshot[0]).toMatchObject({ id: 'task-a', type: 'task' });
    expect(snapshot[1]).toMatchObject({ id: 'msg-a', type: 'whatsapp' });
    expect(snapshot[2]).toMatchObject({ id: 'pay-a', type: 'payment' });
    expect(snapshot[3]).toMatchObject({ id: 'inc-a', type: 'incident' });
    expect(snapshot.at(-1)).toMatchObject({ id: 'sanc-b', type: 'sanction' });
  });

  it('caps total events at 50', async () => {
    setupDbSelectChain([]);
    const lotsOfPayments: PaymentRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `pay-${i}`,
      amount: 100 + i,
      status: 'approved',
      created_at: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`,
    }));
    const lotsOfTasks: TaskRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      status: 'pending',
      created_at: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`,
    }));

    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: lotsOfPayments,
      incidents: [],
      tasks: lotsOfTasks,
      sanctions: [],
    });

    expect(feed.length).toBeLessThanOrEqual(50);
  });

  it('whatsapp inbound direction maps to "Inbound" label', async () => {
    setupDbSelectChain([{
      id: 'msg-x',
      direction: 'inbound',
      classification: null,
      status: 'received',
      createdAt: new Date('2026-06-01T10:00:00Z'),
    }]);
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    const wa = feed.find(e => e.type === 'whatsapp');
    expect(wa?.label).toBe('WhatsApp — Inbound');
    expect(wa?.detail).toBeUndefined();
  });

  it('whatsapp outbound direction maps to "Outbound" label', async () => {
    setupDbSelectChain([{
      id: 'msg-y',
      direction: 'outbound',
      classification: 'reminder',
      status: 'sent',
      createdAt: new Date('2026-06-01T11:00:00Z'),
    }]);
    const feed = await buildTenantActivityFeed({
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      payments: [],
      incidents: [],
      tasks: [],
      sanctions: [],
    });
    const wa = feed.find(e => e.type === 'whatsapp');
    expect(wa?.label).toBe('WhatsApp — Outbound');
    expect(wa?.detail).toBe('reminder');
  });
});
