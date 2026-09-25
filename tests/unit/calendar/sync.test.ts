/**
 * Unit tests for src/lib/calendar/sync.ts (item B, blueprint §3.9).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectQueue, updatedRows, insertedRows } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updatedRows: [] as { table: string; patch: unknown }[],
  insertedRows: [] as { table: string; values: unknown }[],
}));

function pushSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

function selectChain() {
  const rows = selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(rows);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => selectChain()),
    update: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.set = (patch: unknown) => {
        (chain as { _patch?: unknown })._patch = patch;
        return chain;
      };
      chain.where = () => {
        updatedRows.push({ table: String(table), patch: (chain as { _patch?: unknown })._patch });
        return Promise.resolve([]);
      };
      return chain;
    }),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        insertedRows.push({ table: String(table), values });
        return Promise.resolve([]);
      },
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  calendarConnections: 'calendarConnections',
  propertyVisits: 'propertyVisits',
  notificationInbox: 'notificationInbox',
  agentJobs: 'agentJobs',
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const mockEnqueueJob = vi.fn(async () => 'job-1');
vi.mock('@/lib/agent/jobs', () => ({ enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args) }));

const mockRescheduleVisit = vi.fn();
vi.mock('@/lib/agent/visits/service', () => ({ rescheduleVisit: (...args: unknown[]) => mockRescheduleVisit(...args) }));

const mockListEventsPage = vi.fn();
vi.mock('@/lib/calendar/google/events', () => ({ listEventsPage: (...args: unknown[]) => mockListEventsPage(...args) }));

const mockEnqueueVisitPush = vi.fn(async () => true);
vi.mock('@/lib/calendar/push', () => ({ enqueueVisitPush: (...args: unknown[]) => mockEnqueueVisitPush(...args) }));

import { classifyRemoteChange, enqueueCalendarSyncOnce, resolveVisitDrift, syncCalendarConnection } from '@/lib/calendar/sync';
import { GoogleApiError } from '@/lib/calendar/types';

const CONNECTION_ROW = {
  id: 'conn-1',
  orgId: 'org-1',
  profileId: 'advisor-1',
  calendarId: 'primary',
  status: 'active',
  syncToken: null,
  syncPageToken: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  updatedRows.length = 0;
  insertedRows.length = 0;
  mockListEventsPage.mockReset();
});

// ─── classifyRemoteChange ────────────────────────────────────────────────────

describe('classifyRemoteChange', () => {
  const visit = { status: 'scheduled', startsAt: new Date('2026-06-01T15:00:00Z'), endsAt: new Date('2026-06-01T15:45:00Z'), googleEventId: 'pfv1' };

  it('classifies a cancelled remote event as deleted', () => {
    expect(classifyRemoteChange(visit, { status: 'cancelled' })).toBe('deleted');
  });

  it('classifies an unchanged time as none', () => {
    expect(classifyRemoteChange(visit, { start: { dateTime: '2026-06-01T15:00:00Z' }, end: { dateTime: '2026-06-01T15:45:00Z' } })).toBe('none');
  });

  it('classifies a time shift beyond tolerance as moved', () => {
    expect(classifyRemoteChange(visit, { start: { dateTime: '2026-06-01T16:00:00Z' }, end: { dateTime: '2026-06-01T16:45:00Z' } })).toBe('moved');
  });

  it('tolerates sub-minute jitter as none', () => {
    expect(classifyRemoteChange(visit, { start: { dateTime: '2026-06-01T15:00:30Z' }, end: { dateTime: '2026-06-01T15:45:30Z' } })).toBe('none');
  });
});

// ─── syncCalendarConnection ──────────────────────────────────────────────────

describe('syncCalendarConnection', () => {
  it('ignores an event of another org', async () => {
    pushSelect([CONNECTION_ROW]); // connection lookup
    mockListEventsPage.mockResolvedValueOnce({
      items: [{ id: 'e1', extendedProperties: { private: { pfOrgId: 'other-org', pfVisitId: 'v1' } } }],
      nextPageToken: null,
      nextSyncToken: 'tok2',
    });
    pushSelect([]); // reconcile: no stale visits

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(updatedRows.some((r) => r.table === 'propertyVisits')).toBe(false);
    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'calendar.sync' }));
  });

  it('ignores an event whose visit belongs to a different profile', async () => {
    pushSelect([CONNECTION_ROW]);
    mockListEventsPage.mockResolvedValueOnce({
      items: [{ id: 'e1', extendedProperties: { private: { pfOrgId: 'org-1', pfVisitId: 'v1' } } }],
      nextPageToken: null,
      nextSyncToken: 'tok2',
    });
    pushSelect([]); // visit lookup scoped to connection.profileId -> none found
    pushSelect([]); // reconcile

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(updatedRows.some((r) => r.table === 'propertyVisits')).toBe(false);
  });

  it('triggers a full resync on 410 fullSyncRequired', async () => {
    pushSelect([CONNECTION_ROW]);
    mockListEventsPage
      .mockRejectedValueOnce(new GoogleApiError(410, 'fullSyncRequired'))
      .mockResolvedValueOnce({ items: [], nextPageToken: null, nextSyncToken: 'fresh-token' });
    pushSelect([]); // reconcile

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(mockListEventsPage).toHaveBeenCalledTimes(2);
    expect(updatedRows.some((r) => r.table === 'calendarConnections' && (r.patch as { lastFullSyncAt?: unknown }).lastFullSyncAt)).toBe(true);
  });

  it('reconciles by enqueuing pushes for stale visits', async () => {
    pushSelect([CONNECTION_ROW]);
    mockListEventsPage.mockResolvedValueOnce({ items: [], nextPageToken: null, nextSyncToken: 'tok' });
    pushSelect([{ id: 'stale-1' }, { id: 'stale-2' }]);

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(mockEnqueueVisitPush).toHaveBeenCalledWith('org-1', 'stale-1', 'advisor-1');
    expect(mockEnqueueVisitPush).toHaveBeenCalledWith('org-1', 'stale-2', 'advisor-1');
  });

  it('self-schedules the next sync run even when nothing changed', async () => {
    pushSelect([CONNECTION_ROW]);
    mockListEventsPage.mockResolvedValueOnce({ items: [], nextPageToken: null, nextSyncToken: 'tok' });
    pushSelect([]);

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', kind: 'calendar.sync', payload: { connectionId: 'conn-1' } }));
  });

  it('does not self-schedule a second sync job when one is already pending/processing for the connection', async () => {
    pushSelect([CONNECTION_ROW]);
    mockListEventsPage.mockResolvedValueOnce({ items: [], nextPageToken: null, nextSyncToken: 'tok' });
    pushSelect([]); // reconcile: no stale visits
    pushSelect([{ id: 'already-queued-job' }]); // enqueueCalendarSyncOnce's dedupe check

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it('ignores a remote event whose id does not match the visit\'s own googleEventId', async () => {
    pushSelect([CONNECTION_ROW]);
    mockListEventsPage.mockResolvedValueOnce({
      items: [{ id: 'e-duplicate', status: 'cancelled', extendedProperties: { private: { pfOrgId: 'org-1', pfVisitId: 'v1' } } }],
      nextPageToken: null,
      nextSyncToken: 'tok2',
    });
    pushSelect([{ id: 'v1', status: 'scheduled', startsAt: new Date(), endsAt: new Date(), googleEventId: 'e-real' }]);
    pushSelect([]); // reconcile

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(updatedRows.some((r) => r.table === 'propertyVisits')).toBe(false);
  });

  it('passes timeMin for an initial full sync (no syncToken) and omits it once a syncToken exists', async () => {
    pushSelect([CONNECTION_ROW]); // syncToken: null
    mockListEventsPage.mockResolvedValueOnce({ items: [], nextPageToken: null, nextSyncToken: 'tok' });
    pushSelect([]); // reconcile

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(mockListEventsPage.mock.calls[0][2].timeMin).toBeInstanceOf(Date);

    mockListEventsPage.mockClear();
    pushSelect([{ ...CONNECTION_ROW, syncToken: 'existing-token' }]);
    mockListEventsPage.mockResolvedValueOnce({ items: [], nextPageToken: null, nextSyncToken: 'tok2' });
    pushSelect([]); // reconcile

    await syncCalendarConnection({ connectionId: 'conn-1' }, 'org-1');

    expect(mockListEventsPage.mock.calls[0][2].timeMin).toBeUndefined();
  });
});

// ─── enqueueCalendarSyncOnce ─────────────────────────────────────────────────

describe('enqueueCalendarSyncOnce', () => {
  it('enqueues when there is no pending/processing sync job for the connection', async () => {
    pushSelect([]);
    const result = await enqueueCalendarSyncOnce('org-1', 'conn-1');
    expect(result).toBe(true);
    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', kind: 'calendar.sync', payload: { connectionId: 'conn-1' } }));
  });

  it('skips when a sync job is already pending/processing for the connection', async () => {
    pushSelect([{ id: 'job-already-queued' }]);
    const result = await enqueueCalendarSyncOnce('org-1', 'conn-1');
    expect(result).toBe(false);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it('forwards runAt when given', async () => {
    pushSelect([]);
    const runAt = new Date('2026-07-01T00:00:00Z');
    await enqueueCalendarSyncOnce('org-1', 'conn-1', runAt);
    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ runAt }));
  });
});

// ─── resolveVisitDrift ───────────────────────────────────────────────────────

describe('resolveVisitDrift', () => {
  const DRIFT_VISIT = {
    id: 'visit-1',
    orgId: 'org-1',
    status: 'scheduled',
    googleSyncStatus: 'drift',
    googleDriftStartsAt: new Date('2026-06-02T10:00:00Z'),
    googleDriftEndsAt: new Date('2026-06-02T10:45:00Z'),
  };

  it('not_found when the visit does not exist', async () => {
    pushSelect([]);
    const result = await resolveVisitDrift({ orgId: 'org-1', visitId: 'visit-1', keep: 'propflow', actorProfileId: 'advisor-1' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('not_drift when the visit is not in drift', async () => {
    pushSelect([{ ...DRIFT_VISIT, googleSyncStatus: 'synced' }]);
    const result = await resolveVisitDrift({ orgId: 'org-1', visitId: 'visit-1', keep: 'propflow', actorProfileId: 'advisor-1' });
    expect(result).toEqual({ ok: false, reason: 'not_drift' });
  });

  it('keep=propflow clears drift columns and force-pushes', async () => {
    pushSelect([DRIFT_VISIT]);
    const result = await resolveVisitDrift({ orgId: 'org-1', visitId: 'visit-1', keep: 'propflow', actorProfileId: 'advisor-1' });
    expect(result).toEqual({ ok: true });
    expect(updatedRows.at(-1)).toMatchObject({ table: 'propertyVisits', patch: { googleDriftStartsAt: null, googleDriftEndsAt: null } });
    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'calendar.push_visit', payload: { visitId: 'visit-1', force: true } }));
  });

  it('keep=google reschedules to the Google time', async () => {
    pushSelect([DRIFT_VISIT]);
    mockRescheduleVisit.mockResolvedValue({ ok: true, visit: { id: 'visit-2' } });
    const result = await resolveVisitDrift({ orgId: 'org-1', visitId: 'visit-1', keep: 'google', actorProfileId: 'advisor-1' });
    expect(result).toEqual({ ok: true });
    expect(mockRescheduleVisit).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', visitId: 'visit-1', newStartsAt: DRIFT_VISIT.googleDriftStartsAt, actor: 'human',
    }));
  });

  it('keep=google maps slot_taken through', async () => {
    pushSelect([DRIFT_VISIT]);
    mockRescheduleVisit.mockResolvedValue({ ok: false, reason: 'slot_taken' });
    const result = await resolveVisitDrift({ orgId: 'org-1', visitId: 'visit-1', keep: 'google', actorProfileId: 'advisor-1' });
    expect(result).toEqual({ ok: false, reason: 'slot_taken' });
  });
});
