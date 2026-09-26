/**
 * Unit tests for src/lib/calendar/connections.ts (item B, blueprint §3.9).
 * Focused on the two behaviors this phase changed: saveConnection's deduped
 * sync enqueue, and disconnectConnection resetting mid-flight visits that
 * never got as far as googleConnectionId.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectQueue, updatedRows, deletedRows, insertedRows } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updatedRows: [] as { table: string; patch: unknown; where: unknown }[],
  deletedRows: [] as { table: string }[],
  insertedRows: [] as { table: string; values: unknown }[],
}));

function pushSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.leftJoin = () => chain;
      chain.where = (w: unknown) => {
        (chain as { _where?: unknown })._where = w;
        return chain;
      };
      chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
      return chain;
    }),
    update: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.set = (patch: unknown) => {
        (chain as { _patch?: unknown })._patch = patch;
        return chain;
      };
      chain.where = (w: unknown) => {
        updatedRows.push({ table: String(table), patch: (chain as { _patch?: unknown })._patch, where: w });
        return Promise.resolve([]);
      };
      return chain;
    }),
    delete: vi.fn((table: unknown) => ({
      where: () => {
        deletedRows.push({ table: String(table) });
        return Promise.resolve([]);
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        insertedRows.push({ table: String(table), values });
        return {
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([{ id: 'conn-1', ...(values as Record<string, unknown>) }]),
          }),
        };
      },
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  calendarConnections: 'calendarConnections',
  notificationInbox: 'notificationInbox',
  profiles: 'profiles',
  propertyVisits: 'propertyVisits',
}));

vi.mock('@/lib/crypto/encrypt', () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(/, '').replace(/\)$/, ''),
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('@/lib/agent/visits/types', () => ({ ACTIVE_VISIT_STATUSES: ['scheduled', 'confirmed'] }));

const mockEnqueueJob = vi.fn(async () => 'job-1');
vi.mock('@/lib/agent/jobs', () => ({ enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args) }));

const mockRefreshAccessToken = vi.fn();
const mockRevokeToken = vi.fn(async () => undefined);
vi.mock('@/lib/calendar/google/oauth', () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
}));

const mockEnqueueCalendarSyncOnce = vi.fn(async () => true);
vi.mock('@/lib/calendar/sync', () => ({
  enqueueCalendarSyncOnce: (...args: unknown[]) => mockEnqueueCalendarSyncOnce(...args),
}));

import { disconnectConnection, saveConnection } from '@/lib/calendar/connections';

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  updatedRows.length = 0;
  deletedRows.length = 0;
  insertedRows.length = 0;
  mockRevokeToken.mockResolvedValue(undefined);
});

// ─── saveConnection ──────────────────────────────────────────────────────────

describe('saveConnection', () => {
  it('enqueues the sync job through the deduped helper, not a raw enqueueJob', async () => {
    pushSelect([]); // no active visits to backfill

    await saveConnection({
      orgId: 'org-1',
      profileId: 'advisor-1',
      googleEmail: 'a@gmail.com',
      refreshToken: 'rt',
      accessToken: 'at',
      expiresAt: new Date(),
      scopes: [],
    });

    expect(mockEnqueueCalendarSyncOnce).toHaveBeenCalledWith('org-1', 'conn-1');
  });
});

// ─── disconnectConnection ────────────────────────────────────────────────────

describe('disconnectConnection', () => {
  it('returns false when there is no connection for the profile', async () => {
    pushSelect([]);
    const result = await disconnectConnection('org-1', 'advisor-1');
    expect(result).toBe(false);
    expect(deletedRows).toHaveLength(0);
  });

  it('deletes the connection and resets visits scoped to it, plus stray pending/error visits for the profile', async () => {
    pushSelect([{ id: 'conn-1', orgId: 'org-1', profileId: 'advisor-1', refreshTokenEnc: 'enc(rt)' }]);

    const result = await disconnectConnection('org-1', 'advisor-1');

    expect(result).toBe(true);
    expect(mockRevokeToken).toHaveBeenCalledWith('rt');
    expect(deletedRows).toEqual([{ table: 'calendarConnections' }]);

    // First reset: visits pointed at this connection. Second reset: mid-flight
    // visits for the profile that never got as far as googleConnectionId.
    expect(updatedRows).toHaveLength(2);
    for (const row of updatedRows) {
      expect(row.patch).toMatchObject({ googleSyncStatus: 'none', googleConnectionId: null, googleEventId: null });
    }
  });

  it('still deletes and resets when the Google revoke call fails (best-effort)', async () => {
    pushSelect([{ id: 'conn-1', orgId: 'org-1', profileId: 'advisor-1', refreshTokenEnc: 'enc(rt)' }]);
    mockRevokeToken.mockRejectedValue(new Error('revoke endpoint down'));

    const result = await disconnectConnection('org-1', 'advisor-1');

    expect(result).toBe(true);
    expect(deletedRows).toEqual([{ table: 'calendarConnections' }]);
  });
});
