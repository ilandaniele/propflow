import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchesLead, type LeadMatchInput, type ListingMatchInput } from '@/lib/leads/listing-alerts';

// ─── matchesLead matrix (pure) ──────────────────────────────────────────────

const BASE_LEAD: LeadMatchInput = { operationType: null, zones: [], budgetMax: null, bedroomsMin: null, pets: null };
const BASE_LISTING: ListingMatchInput = { operation: 'rent', zone: 'Miraflores', price: 2000, bedrooms: 2, petsAllowed: null };

describe('leads/listing-alerts — matchesLead', () => {
  it('rent lead matches a rent listing, not a sale one', () => {
    expect(matchesLead({ ...BASE_LEAD, operationType: 'rent' }, { ...BASE_LISTING, operation: 'rent' })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, operationType: 'rent' }, { ...BASE_LISTING, operation: 'sale' })).toBe(false);
  });

  it('buy lead matches a sale listing, not a rent one', () => {
    expect(matchesLead({ ...BASE_LEAD, operationType: 'buy' }, { ...BASE_LISTING, operation: 'sale' })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, operationType: 'buy' }, { ...BASE_LISTING, operation: 'rent' })).toBe(false);
  });

  it('a null lead operationType matches any listing operation', () => {
    expect(matchesLead(BASE_LEAD, { ...BASE_LISTING, operation: 'rent' })).toBe(true);
    expect(matchesLead(BASE_LEAD, { ...BASE_LISTING, operation: 'sale' })).toBe(true);
  });

  it('an owner-side operationType (supply pipeline) never matches a demand listing scan', () => {
    expect(matchesLead({ ...BASE_LEAD, operationType: 'owner_sell' }, BASE_LISTING)).toBe(false);
  });

  it('zone is accent/case-insensitive; empty zones matches any', () => {
    expect(matchesLead({ ...BASE_LEAD, zones: ['miraflores'] }, { ...BASE_LISTING, zone: 'Miraflores' })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, zones: ['San Isidro'] }, { ...BASE_LISTING, zone: 'san isidro' })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, zones: ['Barranco'] }, { ...BASE_LISTING, zone: 'Miraflores' })).toBe(false);
    expect(matchesLead({ ...BASE_LEAD, zones: [] }, { ...BASE_LISTING, zone: null })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, zones: ['Barranco'] }, { ...BASE_LISTING, zone: null })).toBe(false);
  });

  it('price must be within 10% over budgetMax', () => {
    expect(matchesLead({ ...BASE_LEAD, budgetMax: 2000 }, { ...BASE_LISTING, price: 2200 })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, budgetMax: 2000 }, { ...BASE_LISTING, price: 2201 })).toBe(false);
    expect(matchesLead({ ...BASE_LEAD, budgetMax: null }, { ...BASE_LISTING, price: 999999 })).toBe(true);
  });

  it('bedrooms must meet the minimum', () => {
    expect(matchesLead({ ...BASE_LEAD, bedroomsMin: 2 }, { ...BASE_LISTING, bedrooms: 2 })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, bedroomsMin: 3 }, { ...BASE_LISTING, bedrooms: 2 })).toBe(false);
    expect(matchesLead({ ...BASE_LEAD, bedroomsMin: 1 }, { ...BASE_LISTING, bedrooms: null })).toBe(false);
  });

  it('pets===true requires petsAllowed!==false', () => {
    expect(matchesLead({ ...BASE_LEAD, pets: true }, { ...BASE_LISTING, petsAllowed: false })).toBe(false);
    expect(matchesLead({ ...BASE_LEAD, pets: true }, { ...BASE_LISTING, petsAllowed: true })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, pets: true }, { ...BASE_LISTING, petsAllowed: null })).toBe(true);
    expect(matchesLead({ ...BASE_LEAD, pets: false }, { ...BASE_LISTING, petsAllowed: false })).toBe(true);
  });
});

// ─── runListingAlertScan (db-backed) ────────────────────────────────────────

const { getPipelineStages, sendVisitMessage, appendSystemOutboundToHistory, dbMock, queues } = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    insertReturnQueue: [] as unknown[][],
    insertCalls: [] as Array<{ values: unknown }>,
    updateCalls: [] as Array<{ values: unknown }>,
  };

  function selectChain() {
    const rows = state.selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
    return chain;
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

  function updateChain() {
    return {
      set: (values: unknown) => {
        state.updateCalls.push({ values });
        return { where: async () => undefined };
      },
    };
  }

  const db = { select: () => selectChain(), insert: () => insertChain(), update: () => updateChain() };

  return {
    getPipelineStages: vi.fn(),
    sendVisitMessage: vi.fn(async () => ({ success: true, providerMessageId: 'wamid-1' })),
    appendSystemOutboundToHistory: vi.fn(async () => 'msg-1'),
    dbMock: db,
    queues: state,
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/leads/stages', () => ({ getPipelineStages }));
vi.mock('@/lib/agent/visits/messaging', () => ({ sendVisitMessage }));
vi.mock('@/lib/agent/session', () => ({ appendSystemOutboundToHistory }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runListingAlertScan } from '@/lib/leads/listing-alerts';

const OPEN_STAGES = [{ id: 's1', orgId: 'org-1', pipeline: 'demand', key: 'contacted', label: 'Contactado', position: 0, kind: 'open', color: null, isSystem: true, archived: false }];

const CONFIG_ROW_ENABLED = {
  orgId: 'org-1',
  timezone: 'America/Lima',
  channelsEnabled: { whatsapp: true, web: false, voice: false },
  followupPolicy: { enabled: true, steps: [], sendWindow: { startMinute: 0, endMinute: 1440 }, listingAlerts: { enabled: true, coldAfterDays: 7, minDaysBetween: 7, maxPerOrgPerRun: 200, template: 'propiedad_nueva' } },
};

const LISTING_ROW = { id: 'listing-1', title: 'Depa en Miraflores', operation: 'rent', zone: 'Miraflores', price: '2000', currency: 'PEN', bedrooms: 2, petsAllowed: null };

const LEAD_ROW = {
  id: 'lead-1', fullName: 'Jane Doe', phone: '+51999999999', operationType: 'rent', zones: [], budgetMax: null,
  bedroomsMin: null, pets: null, intentTag: 'cold', lastListingAlertAt: null,
};

function resetQueues() {
  queues.selectQueue.length = 0;
  queues.insertReturnQueue.length = 0;
  queues.insertCalls.length = 0;
  queues.updateCalls.length = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetQueues();
  getPipelineStages.mockResolvedValue(OPEN_STAGES);
  sendVisitMessage.mockResolvedValue({ success: true, providerMessageId: 'wamid-1' });
});

describe('leads/listing-alerts — runListingAlertScan', () => {
  it('sends nothing for an org with listingAlerts disabled', async () => {
    queues.selectQueue.push([{ ...CONFIG_ROW_ENABLED, followupPolicy: { ...CONFIG_ROW_ENABLED.followupPolicy, listingAlerts: { ...CONFIG_ROW_ENABLED.followupPolicy.listingAlerts, enabled: false } } }]);
    const result = await runListingAlertScan();
    expect(result).toEqual({ orgs: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('sends one alert to a matching cold lead and claims it', async () => {
    queues.selectQueue.push([CONFIG_ROW_ENABLED]); // agentConfigs
    queues.selectQueue.push([LISTING_ROW]); // recent listings
    queues.selectQueue.push([LEAD_ROW]); // candidate leads
    queues.selectQueue.push([]); // agentSessions for lead-1 (no session -> skip history append)
    queues.insertReturnQueue.push([{ id: 'alert-1' }]); // claim succeeds

    const result = await runListingAlertScan();
    expect(result).toEqual({ orgs: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sendVisitMessage).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', phone: '+51999999999' }));
    expect(appendSystemOutboundToHistory).not.toHaveBeenCalled();
  });

  it('does not re-send a duplicate (lead, listing) claim', async () => {
    queues.selectQueue.push([CONFIG_ROW_ENABLED]);
    queues.selectQueue.push([LISTING_ROW]);
    queues.selectQueue.push([LEAD_ROW]);
    queues.insertReturnQueue.push([]); // ON CONFLICT DO NOTHING -> already claimed

    const result = await runListingAlertScan();
    expect(result).toEqual({ orgs: 1, sent: 0, skipped: 0, failed: 0 });
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('skips an org with shadowMode on entirely', async () => {
    queues.selectQueue.push([{ ...CONFIG_ROW_ENABLED, shadowMode: true }]); // agentConfigs
    const result = await runListingAlertScan();
    expect(result).toEqual({ orgs: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('skips an org this run when now falls outside policy.sendWindow in org timezone', async () => {
    // 2026-09-08T04:00:00Z == 2026-09-07 23:00 America/Lima (UTC-5) — before a 09:00-20:00 window.
    const narrowWindow = {
      ...CONFIG_ROW_ENABLED,
      followupPolicy: { ...CONFIG_ROW_ENABLED.followupPolicy, sendWindow: { startMinute: 540, endMinute: 1200 } },
    };
    queues.selectQueue.push([narrowWindow]); // agentConfigs

    const result = await runListingAlertScan(new Date('2026-09-08T04:00:00.000Z'));
    expect(result).toEqual({ orgs: 1, sent: 0, skipped: 0, failed: 0 });
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('respects maxPerOrgPerRun', async () => {
    const cappedConfig = { ...CONFIG_ROW_ENABLED, followupPolicy: { ...CONFIG_ROW_ENABLED.followupPolicy, listingAlerts: { ...CONFIG_ROW_ENABLED.followupPolicy.listingAlerts, maxPerOrgPerRun: 1 } } };
    queues.selectQueue.push([cappedConfig]);
    queues.selectQueue.push([LISTING_ROW]);
    queues.selectQueue.push([{ ...LEAD_ROW, id: 'lead-1', phone: '+51999999991' }, { ...LEAD_ROW, id: 'lead-2', phone: '+51999999992' }]);
    queues.selectQueue.push([]); // session for lead-1
    queues.insertReturnQueue.push([{ id: 'alert-1' }]); // lead-1 claim succeeds

    const result = await runListingAlertScan();
    expect(result.sent).toBe(1);
    expect(sendVisitMessage).toHaveBeenCalledTimes(1);
  });
});
