import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db: dbMock, pushSelect, getInserted, getUpdated, resetMock, setVisitInsertError } = vi.hoisted(() => {
  let selectQueue: unknown[][] = [];
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
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
            result.returning = async () => [{ ...DEFAULT_VISIT_ROW, ...(s as object) }];
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
    execute: async () => undefined,
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  };

  return {
    db,
    pushSelect: (rows: unknown[]) => selectQueue.push(rows),
    getInserted: () => inserted,
    getUpdated: () => updated,
    resetMock: () => {
      selectQueue = [];
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

import { bookVisit, cancelVisit } from '@/lib/agent/visits/service';
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

  it('maps a 23P01 exclusion violation (on e.cause) to slot_taken', async () => {
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]); // lead
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]); // advisor
    setVisitInsertError(new Error('duplicate key', { cause: { code: '23P01' } }));

    const result = await bookVisit(bookArgs({ enforcePhoneCap: false }));
    expect(result).toEqual({ ok: false, reason: 'slot_taken' });
  });

  it('enforces the per-phone cap', async () => {
    pushSelect([{ id: 'lead-1', stage: 'new', assignedProfileId: null }]); // lead
    pushSelect([{ role: 'admin', acceptsVisits: true, bufferMinutes: 15 }]); // advisor
    const activeVisits = Array.from({ length: MAX_ACTIVE_VISITS_PER_PHONE }, (_, i) => ({ id: `v-${i}` }));
    pushSelect(activeVisits); // cap check

    const result = await bookVisit(bookArgs({ enforcePhoneCap: true }));
    expect(result).toEqual({ ok: false, reason: 'cap_reached' });
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

  it('inserts the planned agent_jobs rows in the same transaction as the visit', async () => {
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
