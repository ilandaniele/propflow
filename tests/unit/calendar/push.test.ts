/**
 * Unit tests for src/lib/calendar/push.ts (item B, blueprint §3.9).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectQueue, updatedRows, insertedJobs } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updatedRows: [] as unknown[],
  insertedJobs: [] as unknown[],
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
      chain.where = () => chain;
      chain.limit = async () => selectQueue.shift() ?? [];
      return chain;
    }),
    update: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.set = (patch: unknown) => {
        chain._patch = patch;
        return chain;
      };
      chain.where = () => {
        updatedRows.push(chain._patch);
        return Promise.resolve([]);
      };
      return chain;
    }),
  },
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const mockGetConnectionForProfile = vi.fn();
vi.mock('@/lib/calendar/connections', () => ({
  getConnectionForProfile: (...args: unknown[]) => mockGetConnectionForProfile(...args),
}));

const mockGetOrCreateAgentConfig = vi.fn(async () => ({ timezone: 'America/Lima' }));
vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: (...args: unknown[]) => mockGetOrCreateAgentConfig(...args),
}));

const mockInsertEvent = vi.fn();
const mockPatchEvent = vi.fn();
const mockDeleteEvent = vi.fn();
vi.mock('@/lib/calendar/google/events', () => ({
  buildVisitEvent: vi.fn(() => ({ summary: 's', description: 'd' })),
  insertEvent: (...args: unknown[]) => mockInsertEvent(...args),
  patchEvent: (...args: unknown[]) => mockPatchEvent(...args),
  deleteEvent: (...args: unknown[]) => mockDeleteEvent(...args),
}));

const mockEnqueueJob = vi.fn(async () => 'job-1');
vi.mock('@/lib/agent/jobs', () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

import { enqueueVisitPush, pushVisitToCalendar } from '@/lib/calendar/push';
import { CalendarAuthError, GoogleApiError } from '@/lib/calendar/types';

const ACTIVE_CONNECTION = { id: 'conn-1', orgId: 'org-1', profileId: 'advisor-1', calendarId: 'primary', status: 'active', writeEvents: true, freebusyEnabled: true, googleEmail: 'a@gmail.com', lastSyncedAt: null, lastError: null };

function visitRow(overrides: Record<string, unknown> = {}) {
  return {
    visit: {
      id: 'visit-1',
      orgId: 'org-1',
      leadId: 'lead-1',
      listingId: null,
      profileId: 'advisor-1',
      sessionId: null,
      contactPhone: '+51999',
      startsAt: new Date('2026-06-01T15:00:00Z'),
      endsAt: new Date('2026-06-01T15:45:00Z'),
      blockedUntil: new Date('2026-06-01T16:00:00Z'),
      status: 'scheduled',
      createdBy: 'agent',
      sourceChannel: 'whatsapp',
      rescheduledFromId: null,
      googleEventId: null,
      googleSyncStatus: 'pending',
      notes: null,
      feedback: null,
      ...overrides,
    },
    listingTitle: null,
    advisorName: null,
    leadName: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  updatedRows.length = 0;
  insertedJobs.length = 0;
  mockGetConnectionForProfile.mockResolvedValue(ACTIVE_CONNECTION);
});

describe('enqueueVisitPush', () => {
  it('is a no-op with no active write-enabled connection', async () => {
    mockGetConnectionForProfile.mockResolvedValue(null);
    const result = await enqueueVisitPush('org-1', 'visit-1', 'advisor-1');
    expect(result).toBe(false);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it('sets pending and enqueues the push job when connected', async () => {
    const result = await enqueueVisitPush('org-1', 'visit-1', 'advisor-1');
    expect(result).toBe(true);
    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', kind: 'calendar.push_visit', payload: { visitId: 'visit-1' } }));
  });
});

describe('pushVisitToCalendar', () => {
  it('upserts the event for an active visit', async () => {
    pushSelect([visitRow()]);
    mockInsertEvent.mockResolvedValue({ id: 'pfv1', etag: '"e1"' });

    await pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1');

    expect(mockInsertEvent).toHaveBeenCalled();
    expect(updatedRows.at(-1)).toMatchObject({ googleSyncStatus: 'synced', googleEventId: 'pfv1' });
  });

  it('deletes and detaches a cancelled visit', async () => {
    pushSelect([visitRow({ status: 'cancelled', googleEventId: 'pfv1' })]);

    await pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1');

    expect(mockDeleteEvent).toHaveBeenCalledWith('conn-1', 'primary', 'pfv1');
    expect(updatedRows.at(-1)).toMatchObject({ googleSyncStatus: 'detached', googleEventId: null });
  });

  it('throws on a 500 so the job retries', async () => {
    pushSelect([visitRow()]);
    mockInsertEvent.mockRejectedValue(new GoogleApiError(500, 'backendError'));

    await expect(pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1')).rejects.toBeInstanceOf(GoogleApiError);
  });

  it('sets error status without throwing on a non-retryable 4xx', async () => {
    pushSelect([visitRow()]);
    mockInsertEvent.mockRejectedValue(new GoogleApiError(403, 'forbidden'));

    await expect(pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1')).resolves.toBeUndefined();
    expect(updatedRows.at(-1)).toMatchObject({ googleSyncStatus: 'error', googleSyncError: 'forbidden' });
  });

  it('returns quietly on CalendarAuthError (already marked revoked)', async () => {
    pushSelect([visitRow()]);
    mockInsertEvent.mockRejectedValue(new CalendarAuthError());
    await expect(pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1')).resolves.toBeUndefined();
  });

  it('is a no-op when there is no connection', async () => {
    pushSelect([visitRow()]);
    mockGetConnectionForProfile.mockResolvedValue(null);
    await pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1');
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when the visit no longer exists', async () => {
    pushSelect([]);
    await pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1');
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it('leaves a drift visit alone unless forced', async () => {
    pushSelect([visitRow({ googleSyncStatus: 'drift' })]);
    await pushVisitToCalendar({ visitId: 'visit-1' }, 'org-1');
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it('processes a drift visit when forced', async () => {
    pushSelect([visitRow({ googleSyncStatus: 'drift' })]);
    mockInsertEvent.mockResolvedValue({ id: 'pfv1', etag: '"e1"' });
    await pushVisitToCalendar({ visitId: 'visit-1', force: true }, 'org-1');
    expect(mockInsertEvent).toHaveBeenCalled();
  });
});
