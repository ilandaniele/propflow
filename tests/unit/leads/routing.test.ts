import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RoutingMember } from '@/lib/leads/types';

const { selectQueue, updateCalls, insertedValues, executedSql, txExecuteCalls, agentConfig, notifyMock } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updateCalls: [] as Array<{ table: string; set: Record<string, unknown> }>,
  insertedValues: [] as Array<{ table: string; values: Record<string, unknown> }>,
  executedSql: [] as unknown[],
  txExecuteCalls: [] as unknown[],
  agentConfig: { routingMode: 'round_robin' as 'round_robin' | 'weighted' | 'manual' },
  notifyMock: vi.fn(async () => {}),
}));

function selectChain() {
  const rows = selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.groupBy = () => Promise.resolve(rows);
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function tableNameOf(table: unknown): string {
  // drizzle table objects carry a symbol-keyed name; the schema mock below
  // just tags plain objects with `_tableName` so tests can assert on it.
  return (table as { _tableName?: string })?._tableName ?? 'unknown';
}

function makeQueryable(execTracker: unknown[]) {
  return {
    select: vi.fn(() => selectChain()),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((set: Record<string, unknown>) => {
        updateCalls.push({ table: tableNameOf(table), set });
        return {
          where: vi.fn(() => ({ returning: vi.fn(async () => (tableNameOf(table) === 'crm_leads' ? [{ id: 'lead-1' }] : [])) })),
        };
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push({ table: tableNameOf(table), values });
        return { returning: vi.fn(async () => [values]) };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => {}) })),
    execute: vi.fn((sql: unknown) => {
      execTracker.push(sql);
      return Promise.resolve();
    }),
  };
}

vi.mock('@/lib/db', () => ({
  db: {
    ...makeQueryable(executedSql),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(makeQueryable(txExecuteCalls))),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  crmLeads: { _tableName: 'crm_leads', id: 'id', assignedProfileId: 'assigned_profile_id' },
  leadRoutingMembers: { _tableName: 'lead_routing_members', orgId: 'org_id', profileId: 'profile_id' },
  leadAssignments: { _tableName: 'lead_assignments' },
  leadPipelineStages: { _tableName: 'lead_pipeline_stages' },
  profiles: { _tableName: 'profiles' },
}));

vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: vi.fn(async () => agentConfig),
}));

vi.mock('@/lib/leads/notify-advisor', () => ({
  notifyAdvisorLeadAssigned: notifyMock,
}));

import { pickAssignee, routeLead } from '@/lib/leads/routing';

function member(overrides: Partial<RoutingMember> = {}): RoutingMember {
  return {
    profileId: 'p1',
    pipeline: 'both',
    weight: 1,
    active: true,
    maxOpenLeads: null,
    assignedCount: 0,
    lastAssignedAt: null,
    ...overrides,
  };
}

describe('leads/routing pickAssignee', () => {
  it('round robin picks the member with the oldest (or null) lastAssignedAt', () => {
    const members = [
      member({ profileId: 'a', lastAssignedAt: new Date('2026-01-01T00:00:00Z') }),
      member({ profileId: 'b', lastAssignedAt: null }),
    ];
    expect(pickAssignee(members, 'round_robin', 'demand', {})).toBe('b');
  });

  it('weighted 3:1 over 8 picks converges to a 6:2 split', () => {
    const a: RoutingMember = member({ profileId: 'a', weight: 3 });
    const b: RoutingMember = member({ profileId: 'b', weight: 1 });
    const counts: Record<string, number> = { a: 0, b: 0 };
    let clock = 0;

    for (let i = 0; i < 8; i++) {
      const picked = pickAssignee([a, b], 'weighted', 'demand', {});
      expect(picked).not.toBeNull();
      counts[picked as string]++;
      const target = picked === 'a' ? a : b;
      target.assignedCount++;
      target.lastAssignedAt = new Date(++clock);
    }

    expect(counts).toEqual({ a: 6, b: 2 });
  });

  it('excludes a member at or over maxOpenLeads (the cap)', () => {
    const members = [
      member({ profileId: 'a', maxOpenLeads: 2 }),
      member({ profileId: 'b' }),
    ];
    expect(pickAssignee(members, 'round_robin', 'demand', { a: 2 })).toBe('b');
  });

  it('filters by pipeline (a demand-only member is skipped for supply)', () => {
    const members = [
      member({ profileId: 'a', pipeline: 'demand' }),
      member({ profileId: 'b', pipeline: 'supply' }),
    ];
    expect(pickAssignee(members, 'round_robin', 'supply', {})).toBe('b');
  });

  it('returns null for an empty or fully-ineligible member list', () => {
    expect(pickAssignee([], 'round_robin', 'demand', {})).toBeNull();
    expect(pickAssignee([member({ active: false })], 'round_robin', 'demand', {})).toBeNull();
  });
});

describe('leads/routing routeLead', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    updateCalls.length = 0;
    insertedValues.length = 0;
    executedSql.length = 0;
    txExecuteCalls.length = 0;
    agentConfig.routingMode = 'round_robin';
    notifyMock.mockClear();
    notifyMock.mockImplementation(async () => {});
  });

  it('no-ops without opening a transaction when routing_mode is manual', async () => {
    agentConfig.routingMode = 'manual';
    const result = await routeLead({ orgId: 'org-1', leadId: 'lead-1' });
    expect(result).toEqual({ profileId: null, method: null });
    expect(updateCalls.length).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('no-ops when the lead is already assigned', async () => {
    selectQueue.push([{ id: 'lead-1', pipeline: 'demand', assignedProfileId: 'p-existing' }]); // lead select
    const result = await routeLead({ orgId: 'org-1', leadId: 'lead-1' });
    expect(result).toEqual({ profileId: null, method: null });
    expect(updateCalls.find((c) => c.table === 'crm_leads')).toBeUndefined();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('takes the per-org advisory lock inside the transaction', async () => {
    selectQueue.push([{ id: 'lead-1', pipeline: 'demand', assignedProfileId: null }]); // lead
    selectQueue.push([]); // no eligible members -> no-op, but the lock is taken first
    await routeLead({ orgId: 'org-1', leadId: 'lead-1' });
    expect(txExecuteCalls.length).toBe(1);
  });

  it('assigns, bumps counters, records the assignment, and notifies the advisor', async () => {
    selectQueue.push([{ id: 'lead-1', pipeline: 'demand', assignedProfileId: null }]); // lead
    selectQueue.push([
      { profileId: 'adv-1', pipeline: 'both', weight: 1, active: true, maxOpenLeads: null, assignedCount: 0, lastAssignedAt: null },
    ]); // routing members
    selectQueue.push([]); // open lead counts (empty = 0 for everyone)

    const result = await routeLead({ orgId: 'org-1', leadId: 'lead-1' });

    expect(result).toEqual({ profileId: 'adv-1', method: 'round_robin' });
    expect(updateCalls.some((c) => c.table === 'crm_leads' && c.set.assignedProfileId === 'adv-1')).toBe(true);
    expect(updateCalls.some((c) => c.table === 'lead_routing_members')).toBe(true);
    expect(insertedValues.some((v) => v.table === 'lead_assignments' && v.values.profileId === 'adv-1')).toBe(true);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', leadId: 'lead-1', profileId: 'adv-1', method: 'round_robin' }));
  });

  it('never throws when the post-commit notification fails', async () => {
    notifyMock.mockImplementation(async () => {
      throw new Error('whatsapp down');
    });
    selectQueue.push([{ id: 'lead-1', pipeline: 'demand', assignedProfileId: null }]);
    selectQueue.push([
      { profileId: 'adv-1', pipeline: 'both', weight: 1, active: true, maxOpenLeads: null, assignedCount: 0, lastAssignedAt: null },
    ]);
    selectQueue.push([]);

    await expect(routeLead({ orgId: 'org-1', leadId: 'lead-1' })).resolves.toEqual({ profileId: 'adv-1', method: 'round_robin' });
  });
});
