import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above regular declarations, so everything
// they close over must be created via vi.hoisted() to avoid a TDZ error.
const {
  getOrCreateAgentConfig,
  getLead,
  getStage,
  getSessionById,
  appendSystemOutboundToHistory,
  sendVisitMessage,
  dbMock,
  queues,
} = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    updateReturnQueue: [] as unknown[][],
    insertReturnQueue: [] as unknown[][],
    updateCalls: [] as Array<{ values: unknown }>,
    insertCalls: [] as Array<{ values: unknown }>,
  };

  function selectChain() {
    const rows = state.selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  }

  function updateChain() {
    return {
      set: (values: unknown) => {
        state.updateCalls.push({ values });
        const result: Record<string, unknown> = {};
        result.where = () => {
          const inner: Record<string, unknown> = {};
          inner.returning = async () => state.updateReturnQueue.shift() ?? [];
          inner.then = (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve);
          return inner;
        };
        return result;
      },
    };
  }

  function insertChain() {
    return {
      values: (values: unknown) => {
        state.insertCalls.push({ values });
        const obj: Record<string, unknown> = {};
        obj.onConflictDoNothing = () => obj;
        obj.returning = async () => state.insertReturnQueue.shift() ?? [];
        return obj;
      },
    };
  }

  const db: Record<string, unknown> = {
    select: () => selectChain(),
    update: () => updateChain(),
    insert: () => insertChain(),
  };
  db.transaction = async (cb: (tx: typeof db) => unknown) => cb(db);

  return {
    getOrCreateAgentConfig: vi.fn(),
    getLead: vi.fn(),
    getStage: vi.fn(),
    getSessionById: vi.fn(),
    appendSystemOutboundToHistory: vi.fn(async () => 'msg-1'),
    sendVisitMessage: vi.fn(async () => ({ success: true, providerMessageId: 'wamid-1' })),
    dbMock: db,
    queues: state,
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));
vi.mock('@/lib/agent/lead', () => ({ getLead }));
vi.mock('@/lib/leads/stages', () => ({ getStage }));
vi.mock('@/lib/agent/session', () => ({ getSessionById, appendSystemOutboundToHistory }));
vi.mock('@/lib/agent/visits/messaging', () => ({ sendVisitMessage }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runFollowupJob, scheduleFollowupSequence, stopFollowups, sweepStaleFollowups } from '@/lib/leads/followups';

const LEAD = {
  id: 'lead-1', fullName: 'Jane Doe', phone: '+51999999999', operationType: 'rent', pipeline: 'demand',
  budgetMin: null, budgetMax: null, currency: 'PEN', zones: [], bedroomsMin: null, moveInDate: null,
  timeline: null, pets: null, score: 50, intentTag: null, stage: 'contacted', doNotContact: false,
};

const SESSION = {
  id: 'session-1', orgId: 'org-1', channel: 'whatsapp' as const, externalId: '+51999999999', leadId: 'lead-1',
  whatsappConversationId: 'conv-1', mode: 'ai' as const, summary: null, agentTurnCount: 1, language: 'es' as const,
  attribution: null, handoffReason: null, windowExpiresAt: new Date(Date.now() + 60 * 60 * 1000), lastAgentTurnAt: null,
  lastInboundAt: null,
};

const STAGE = { id: 's1', orgId: 'org-1', pipeline: 'demand' as const, key: 'contacted', label: 'Contactado', position: 1, kind: 'open' as const, color: null, isSystem: true, archived: false };

function resetDbQueues() {
  queues.selectQueue.length = 0;
  queues.updateReturnQueue.length = 0;
  queues.insertReturnQueue.length = 0;
  queues.updateCalls.length = 0;
  queues.insertCalls.length = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbQueues();
  getOrCreateAgentConfig.mockResolvedValue({
    timezone: 'America/Lima',
    followupPolicy: { enabled: true, steps: [{ afterMinutes: 120, kind: 'text' }, { afterMinutes: 1440, kind: 'template', template: 'seguimiento_lead' }], sendWindow: { startMinute: 0, endMinute: 1440 }, listingAlerts: { enabled: false, coldAfterDays: 7, minDaysBetween: 7, maxPerOrgPerRun: 200, template: 'propiedad_nueva' } },
  });
  getLead.mockResolvedValue({ ...LEAD });
  getStage.mockResolvedValue({ ...STAGE });
  getSessionById.mockResolvedValue({ ...SESSION });
  sendVisitMessage.mockResolvedValue({ success: true, providerMessageId: 'wamid-1' });
});

describe('leads/followups — scheduleFollowupSequence', () => {
  it('cancels any still-scheduled rows before inserting the fresh sequence (supersede)', async () => {
    queues.insertReturnQueue.push([{ id: 'fu-1', scheduledFor: new Date('2026-03-10T14:00:00Z') }, { id: 'fu-2', scheduledFor: new Date('2026-03-11T14:00:00Z') }]);
    const count = await scheduleFollowupSequence({ orgId: 'org-1', leadId: 'lead-1', sessionId: 'session-1', anchorAt: new Date('2026-03-10T12:00:00Z') });
    expect(count).toBe(2);
    expect(queues.updateCalls[0].values).toMatchObject({ status: 'cancelled', stopReason: 'superseded' });
    expect(queues.insertCalls[0].values).toHaveLength(2); // lead_followups rows
    expect(queues.insertCalls[1].values).toHaveLength(2); // agent_jobs rows
    expect(queues.updateCalls[1].values).toMatchObject({ followupState: 'active' });
  });

  it('does not schedule anything when the org policy is disabled', async () => {
    getOrCreateAgentConfig.mockResolvedValue({
      timezone: 'America/Lima',
      followupPolicy: { enabled: false, steps: [{ afterMinutes: 120, kind: 'text' }], sendWindow: { startMinute: 0, endMinute: 1440 }, listingAlerts: { enabled: false, coldAfterDays: 7, minDaysBetween: 7, maxPerOrgPerRun: 200, template: 'propiedad_nueva' } },
    });
    const count = await scheduleFollowupSequence({ orgId: 'org-1', leadId: 'lead-1', sessionId: 'session-1', anchorAt: new Date('2026-03-10T12:00:00Z') });
    expect(count).toBe(0);
    expect(queues.updateCalls).toHaveLength(0);
    expect(queues.insertCalls).toHaveLength(0);
  });
});

describe('leads/followups — stopFollowups', () => {
  it('cancels scheduled rows and marks the lead stopped', async () => {
    queues.updateReturnQueue.push([{ id: 'fu-1' }]);
    const count = await stopFollowups('org-1', 'lead-1', 'do_not_contact');
    expect(count).toBe(1);
    expect(queues.updateCalls[0].values).toMatchObject({ status: 'cancelled', stopReason: 'do_not_contact' });
    expect(queues.updateCalls[1].values).toMatchObject({ followupState: 'stopped', followupStopReason: 'do_not_contact' });
  });
});

const FOLLOWUP_ROW = {
  id: 'fu-1', orgId: 'org-1', leadId: 'lead-1', sessionId: 'session-1',
  sequenceAnchorAt: new Date('2026-03-10T12:00:00Z'), step: 1, kind: 'text', templateName: null,
  scheduledFor: new Date('2026-03-10T14:00:00Z'), status: 'sending', stopReason: null, sentAt: null,
};

describe('leads/followups — runFollowupJob', () => {
  it('is a no-op when the row was already claimed (superseded/cancelled/retried)', async () => {
    queues.updateReturnQueue.push([]); // claim UPDATE returns nothing
    await runFollowupJob({ followupId: 'fu-1' }, 'org-1');
    expect(getLead).not.toHaveBeenCalled();
  });

  it('stops the sequence when the session is in human mode', async () => {
    queues.updateReturnQueue.push([{ ...FOLLOWUP_ROW }]); // claim
    getSessionById.mockResolvedValue({ ...SESSION, mode: 'human' });
    queues.updateReturnQueue.push([{ id: 'fu-2' }]); // stopFollowups' cancel-scheduled update
    await runFollowupJob({ followupId: 'fu-1' }, 'org-1');
    expect(queues.updateCalls[1].values).toMatchObject({ status: 'cancelled', stopReason: 'human_takeover' });
    expect(queues.updateCalls[2].values).toMatchObject({ status: 'cancelled', stopReason: 'human_takeover' }); // stopFollowups' scheduled->cancelled
    expect(queues.updateCalls[3].values).toMatchObject({ followupState: 'stopped' });
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('skips a text step outside the 24h window and lets the sequence continue', async () => {
    queues.updateReturnQueue.push([{ ...FOLLOWUP_ROW, kind: 'text' }]); // claim
    getSessionById.mockResolvedValue({ ...SESSION, windowExpiresAt: new Date(Date.now() - 60 * 1000) });
    queues.selectQueue.push([]); // hasActiveVisit select
    queues.selectQueue.push([{ scheduledFor: new Date('2026-03-11T14:00:00Z') }]); // recomputeNextFollowupAt select
    await runFollowupJob({ followupId: 'fu-1' }, 'org-1');
    expect(queues.updateCalls[1].values).toMatchObject({ status: 'skipped', stopReason: 'window_closed' });
    expect(queues.updateCalls[2].values).toMatchObject({ nextFollowupAt: new Date('2026-03-11T14:00:00Z') });
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('reverts the row to scheduled and throws on a send failure', async () => {
    queues.updateReturnQueue.push([{ ...FOLLOWUP_ROW }]); // claim
    sendVisitMessage.mockResolvedValue({ success: false, error: 'window_closed' });
    await expect(runFollowupJob({ followupId: 'fu-1' }, 'org-1')).rejects.toThrow();
    expect(queues.updateCalls[1].values).toMatchObject({ status: 'scheduled' });
  });

  it('stops the sequence when the org is in shadow mode', async () => {
    queues.updateReturnQueue.push([{ ...FOLLOWUP_ROW }]); // claim
    getOrCreateAgentConfig.mockResolvedValue({
      timezone: 'America/Lima',
      shadowMode: true,
      followupPolicy: { enabled: true, steps: [{ afterMinutes: 120, kind: 'text' }], sendWindow: { startMinute: 0, endMinute: 1440 }, listingAlerts: { enabled: false, coldAfterDays: 7, minDaysBetween: 7, maxPerOrgPerRun: 200, template: 'propiedad_nueva' } },
    });
    queues.updateReturnQueue.push([{ id: 'fu-2' }]); // stopFollowups' cancel-scheduled update
    await runFollowupJob({ followupId: 'fu-1' }, 'org-1');
    expect(queues.updateCalls[1].values).toMatchObject({ status: 'cancelled', stopReason: 'shadow_mode' });
    expect(queues.updateCalls[2].values).toMatchObject({ status: 'cancelled', stopReason: 'shadow_mode' });
    expect(queues.updateCalls[3].values).toMatchObject({ followupState: 'stopped', followupStopReason: 'shadow_mode' });
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('sends and marks the lead completed on the last step', async () => {
    queues.updateReturnQueue.push([{ ...FOLLOWUP_ROW, step: 2, kind: 'template', templateName: 'seguimiento_lead' }]); // claim
    await runFollowupJob({ followupId: 'fu-1' }, 'org-1');
    expect(sendVisitMessage).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', phone: '+51999999999', template: { name: 'seguimiento_lead', bodyParams: ['Jane'] },
    }));
    expect(queues.updateCalls[1].values).toMatchObject({ status: 'sent' });
    expect(appendSystemOutboundToHistory).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', sessionId: 'session-1' }));
    expect(queues.updateCalls[2].values).toMatchObject({ followupState: 'completed' });
  });
});

describe('leads/followups — sweepStaleFollowups', () => {
  it('marks stale scheduled rows failed and recomputes next_followup_at per affected lead', async () => {
    queues.updateReturnQueue.push([
      { orgId: 'org-1', leadId: 'lead-1' },
      { orgId: 'org-1', leadId: 'lead-2' },
    ]); // the sweep UPDATE ... RETURNING
    queues.selectQueue.push([{ scheduledFor: new Date('2026-03-12T14:00:00Z') }]); // recompute for lead-1
    queues.selectQueue.push([]); // recompute for lead-2 (none left scheduled)

    const count = await sweepStaleFollowups(new Date('2026-03-14T00:00:00Z'));

    expect(count).toBe(2);
    expect(queues.updateCalls[0].values).toMatchObject({ status: 'failed', stopReason: 'job_failed' });
    expect(queues.updateCalls[1].values).toMatchObject({ nextFollowupAt: new Date('2026-03-12T14:00:00Z') });
    expect(queues.updateCalls[2].values).toMatchObject({ nextFollowupAt: null });
  });

  it('is a no-op when nothing is stale', async () => {
    queues.updateReturnQueue.push([]); // no stale rows
    const count = await sweepStaleFollowups(new Date('2026-03-14T00:00:00Z'));
    expect(count).toBe(0);
    expect(queues.updateCalls).toHaveLength(1); // just the sweep UPDATE itself
  });
});
