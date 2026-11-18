import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db: dbMock, DEFAULT_VISIT_ROW, pushSelect, pushUpdateReturn, getInserted, getUpdated, getDeleteCount, resetMock, setVisitInsertError } = vi.hoisted(() => {
  let selectQueue: unknown[][] = [];
  // When empty, updateChain()'s default behavior (DEFAULT_VISIT_ROW merged
  // with the patch) applies — push an override (e.g. []) to simulate a
  // lock/guard update matching zero rows.
  let updateReturnQueue: (unknown[] | undefined)[] = [];
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  let deleteCount = 0;
  let visitInsertError: unknown = null;

  const DEFAULT_VISIT_ROW = {
    id: 'visit-new',
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
    createdByProfileId: null,
    sourceChannel: 'whatsapp',
    rescheduledFromId: null,
    googleEventId: null,
    notes: null,
    cancelReason: null,
    feedback: null,
    outcomeSource: null,
    confirmedAt: null,
    cancelledAt: null,
    completedAt: null,
    reminder24hSentAt: null,
    reminder2hSentAt: null,
    advisorRemindedAt: null,
    postCheckSentAt: null,
    feedbackRequestedAt: null,
    reofferSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function selectChain() {
    const rows = selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.leftJoin = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  }

  function isVisitInsertValues(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && 'startsAt' in (v as object) && 'blockedUntil' in (v as object);
  }

  function insertChain() {
    return {
      values: (v: unknown) => {
        inserted.push(v);
        return {
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          returning: async () => {
            if (isVisitInsertValues(v)) {
              if (visitInsertError) throw visitInsertError;
              return [{ ...DEFAULT_VISIT_ROW, ...v }];
            }
            if (Array.isArray(v)) return v.map((item, i) => ({ id: `job-${i}`, ...(item as object) }));
            return [{ id: 'row-1', ...(v as object) }];
          },
        };
      },
    };
  }

  function updateChain() {
    return {
      set: (s: unknown) => {
        updated.push(s);
        return {
          where: () => {
            const result: Record<string, unknown> = {};
            result.returning = async () => {
              const override = updateReturnQueue.shift();
              return override ?? [{ ...DEFAULT_VISIT_ROW, ...(s as object) }];
            };
            result.then = (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve);
            return result;
          },
        };
      },
    };
  }

  const db = {
    select: () => selectChain(),
    insert: () => insertChain(),
    update: () => updateChain(),
    delete: () => ({
      where: () => {
        deleteCount++;
        return Promise.resolve(undefined);
      },
    }),
    batch: async (items: unknown[]) => Promise.all(items),
  };

  return {
    db,
    DEFAULT_VISIT_ROW,
    pushSelect: (rows: unknown[]) => selectQueue.push(rows),
    pushUpdateReturn: (rows: unknown[]) => updateReturnQueue.push(rows),
    getInserted: () => inserted,
    getUpdated: () => updated,
    getDeleteCount: () => deleteCount,
    resetMock: () => {
      deleteCount = 0;
      selectQueue = [];
      updateReturnQueue = [];
      inserted.length = 0;
      updated.length = 0;
      visitInsertError = null;
    },
    setVisitInsertError: (e: unknown) => {
      visitInsertError = e;
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

// Phase 5 item B: service.ts fires this after commit on every visit change.
// It's fire-and-forget in real code, but it still touches the calendar
// module (which isn't under test here), so it's mocked to a no-op.
vi.mock('@/lib/agent/visits/hooks', () => ({ notifyVisitChanged: vi.fn() }));

import { bookVisit, cancelVisit, markVisitOutcome, rescheduleVisit } from '@/lib/agent/visits/service';
import { VISIT_JOB_KINDS } from '@/lib/agent/visits/job-plan';
import { MAX_ACTIVE_VISITS_PER_PHONE } from '@/lib/agent/visits/types';

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function bookArgs(overrides: Partial<Parameters<typeof bookVisit>[0]> = {}): Parameters<typeof bookVisit>[0] {
  return {
    orgId: 'org-1',
    leadId: 'lead-1',
    listingId: null,
    profileId: 'advisor-1',
    startsAt: FUTURE,
    visitMinutes: 45,
    contactPhone: '+51999',
    createdBy: 'agent',
    sourceChannel: 'whatsapp',
    enforcePhoneCap: true,
    requirePublishedListing: false,
    ...overrides,
  };
}

describe('agent/visits/service — bookVisit', () => {
  beforeEach(() => resetMock());

  it('maps the D1 visit_overlap trigger abort (on e.cause) to slot_taken', async () => {
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]); // lead
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]); // advisor
    setVisitInsertError(new Error('Failed query', {
      cause: new Error('D1_ERROR: visit_overlap: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)'),
    }));

    const result = await bookVisit(bookArgs({ enforcePhoneCap: false }));
    expect(result).toEqual({ ok: false, reason: 'slot_taken' });
  });

  it('enforces the per-phone cap, deleting the just-inserted visit', async () => {
    // Phase 9: bookVisit loads agent_configs.max_active_visits_per_phone
    // first when enforcePhoneCap is true.
    pushSelect([{ orgId: 'org-1', maxActiveVisitsPerPhone: MAX_ACTIVE_VISITS_PER_PHONE }]); // getOrCreateAgentConfig
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]); // lead
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]); // advisor
    // The cap check runs after the insert, so it also counts the new visit.
    const activeVisits = Array.from({ length: MAX_ACTIVE_VISITS_PER_PHONE + 1 }, (_, i) => ({ id: `v-${i}` }));
    pushSelect(activeVisits); // cap check

    const result = await bookVisit(bookArgs({ enforcePhoneCap: true }));
    expect(result).toEqual({ ok: false, reason: 'cap_reached' });
    expect(getDeleteCount()).toBe(1);
  });

  it('allows the booking that brings the phone exactly to the cap', async () => {
    pushSelect([{ orgId: 'org-1', maxActiveVisitsPerPhone: MAX_ACTIVE_VISITS_PER_PHONE }]);
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]);
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]);
    pushSelect(Array.from({ length: MAX_ACTIVE_VISITS_PER_PHONE }, (_, i) => ({ id: `v-${i}` })));

    const result = await bookVisit(bookArgs({ enforcePhoneCap: true }));
    expect(result.ok).toBe(true);
    expect(getDeleteCount()).toBe(0);
  });

  it('skips the cap when enforcePhoneCap is false', async () => {
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]); // lead
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]); // advisor

    const result = await bookVisit(bookArgs({ enforcePhoneCap: false }));
    expect(result.ok).toBe(true);
  });

  it('promotes stage to visit_scheduled for a qualifying lead', async () => {
    pushSelect([{ id: 'lead-1', stage: 'contacted', assignedProfileId: 'advisor-1' }]);
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]);

    const result = await bookVisit(bookArgs({ enforcePhoneCap: false }));
    expect(result.ok).toBe(true);
    expect(getUpdated().some((s) => (s as Record<string, unknown>).stage === 'visit_scheduled')).toBe(true);
  });

  it('inserts the planned agent_jobs rows in the side-effect batch', async () => {
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]);
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]);

    const result = await bookVisit(bookArgs({ enforcePhoneCap: false }));
    expect(result.ok).toBe(true);

    const jobBatch = getInserted().find((v) => Array.isArray(v)) as Array<Record<string, unknown>> | undefined;
    expect(jobBatch).toBeDefined();
    expect(jobBatch!.length).toBeGreaterThan(0);
    expect(jobBatch!.every((j) => typeof j.kind === 'string' && j.orgId === 'org-1')).toBe(true);
  });
});

describe('agent/visits/service — cancelVisit', () => {
  beforeEach(() => resetMock());

  it("returns not_found for a lead's visit that belongs to someone else (never 'forbidden')", async () => {
    pushSelect([]); // no row matches org+visitId+leadId
    const result = await cancelVisit({ orgId: 'org-1', visitId: 'visit-1', leadId: 'lead-other', actor: 'agent' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('agent/visits/service — bookVisit in_past guard', () => {
  beforeEach(() => resetMock());

  it('rejects a start time in the past before touching the DB', async () => {
    const PAST = new Date(Date.now() - 60_000);
    const result = await bookVisit(bookArgs({ startsAt: PAST, enforcePhoneCap: false }));
    expect(result).toEqual({ ok: false, reason: 'in_past' });
    expect(getInserted()).toHaveLength(0);
  });
});

describe('agent/visits/service — bookVisit contactPhone normalization', () => {
  beforeEach(() => resetMock());

  it('normalizes contactPhone to E.164 before it is written', async () => {
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]);
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]);

    const result = await bookVisit(bookArgs({ enforcePhoneCap: false, contactPhone: '51999999999' }));
    expect(result.ok).toBe(true);

    const visitInsert = getInserted().find((v) => v && typeof v === 'object' && 'blockedUntil' in (v as object)) as Record<string, unknown> | undefined;
    expect(visitInsert?.contactPhone).toBe('+51999999999');
  });
});

describe('agent/visits/service — rescheduleVisit', () => {
  beforeEach(() => resetMock());

  const OLD_VISIT = { ...DEFAULT_VISIT_ROW, id: 'visit-1' };
  const reschedule = (newStartsAt: Date) =>
    rescheduleVisit({ orgId: 'org-1', visitId: 'visit-1', leadId: null, newStartsAt, actor: 'human' });

  it('returns not_active when no active visit matches', async () => {
    pushSelect([]); // old-visit select
    expect(await reschedule(FUTURE)).toEqual({ ok: false, reason: 'not_active' });
  });

  it('returns not_active when the compare-and-set claim matches zero rows (concurrent cancel/reschedule)', async () => {
    pushSelect([OLD_VISIT]);
    pushUpdateReturn([]); // UPDATE ... WHERE status = <read status> RETURNING matches nothing
    expect(await reschedule(FUTURE)).toEqual({ ok: false, reason: 'not_active' });
  });

  it('rejects a reschedule to a start time in the past and restores the old visit', async () => {
    pushSelect([OLD_VISIT]);
    const result = await reschedule(new Date(Date.now() - 60_000));
    expect(result).toEqual({ ok: false, reason: 'in_past' });
    expect(getUpdated().at(-1)).toMatchObject({ status: 'scheduled' });
  });

  it('restores the old visit on a soft booking failure, returning the same ok:false shape', async () => {
    pushSelect([OLD_VISIT]);
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]); // lead
    pushSelect([]); // advisor lookup finds nothing -> advisor_invalid

    const result = await reschedule(FUTURE);

    expect(result).toEqual({ ok: false, reason: 'advisor_invalid' });
    expect(getUpdated().at(-1)).toMatchObject({ status: 'scheduled' });
    expect(getInserted()).toHaveLength(0);
  });

  it('maps a visit_overlap abort to slot_taken and restores the old visit', async () => {
    pushSelect([OLD_VISIT]);
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]);
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]);
    setVisitInsertError(new Error('D1_ERROR: visit_overlap: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)'));

    expect(await reschedule(FUTURE)).toEqual({ ok: false, reason: 'slot_taken' });
    expect(getUpdated().at(-1)).toMatchObject({ status: 'scheduled' });
  });

  it('reschedules successfully and links rescheduledFromId back to the old visit', async () => {
    pushSelect([OLD_VISIT]);
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]);
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]);

    const result = await reschedule(FUTURE);

    expect(result.ok).toBe(true);
    const visitInsert = getInserted().find((v) => v && typeof v === 'object' && 'blockedUntil' in (v as object)) as Record<string, unknown>;
    expect(visitInsert.rescheduledFromId).toBe('visit-1');
    expect(getUpdated()[0]).toMatchObject({ status: 'rescheduled' });
  });
});

describe('agent/visits/service — markVisitOutcome', () => {
  beforeEach(() => resetMock());

  it('returns null when the eligible-status/already-started guard matches nothing (already marked, cancelled, or still in the future)', async () => {
    pushUpdateReturn([]); // UPDATE ... WHERE status IN (scheduled, confirmed) AND starts_at <= now matches nothing
    const result = await markVisitOutcome({ orgId: 'org-1', visitId: 'visit-1', outcome: 'completed', source: 'staff' });
    expect(result).toBeNull();
  });

  it('records the outcome and schedules a post_check job when the guard matches', async () => {
    const result = await markVisitOutcome({ orgId: 'org-1', visitId: 'visit-1', outcome: 'completed', source: 'staff' });
    expect(result?.status).toBe('completed');
    expect(getInserted().some((v) => v && typeof v === 'object' && (v as Record<string, unknown>).kind === VISIT_JOB_KINDS.postCheck)).toBe(true);
  });
});
