/**
 * tests/unit/agent/voice/scanners.test.ts — Phase 8-9, item C.
 *
 * Same "SQL-shape" testing strategy as metrics.test.ts (item E): `db.execute`
 * is a fully mocked queue of canned results consumed in call order, so these
 * assert the query text (no LIMIT, unverified-phone filter present) as well
 * as behaviour (disabled policy -> 0, stale rows filtered by the effective
 * window).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';

const { queueOutboundCallMock } = vi.hoisted(() => ({ queueOutboundCallMock: vi.fn() }));

const executedQueries: SQL[] = [];
const resultQueue: unknown[][] = [];

vi.mock('@/lib/db', () => ({
  db: {
    execute: vi.fn(async (q: SQL) => {
      executedQueries.push(q);
      return resultQueue.shift() ?? [];
    }),
  },
}));

vi.mock('@/lib/agent/voice/outbound', () => ({ queueOutboundCall: queueOutboundCallMock }));

function sqlText(q: SQL): string {
  const chunks = (q as unknown as { queryChunks: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (c && typeof c === 'object' && 'value' in (c as Record<string, unknown>)) {
        const v = (c as { value: unknown }).value;
        return Array.isArray(v) ? v.join('') : String(v);
      }
      return typeof c === 'string' ? c : '?';
    })
    .join('');
}

import { scanSpeedToLead, scanVisitConfirmationCalls, scanReactivationCalls } from '@/lib/agent/voice/scanners';

function push(rows: unknown[]): void {
  resultQueue.push(rows);
}

const VOICE_ENABLED_CONFIG_ROW = (voiceConfig: Record<string, unknown>) => ({ org_id: 'org-1', voice_config: voiceConfig });

beforeEach(() => {
  vi.clearAllMocks();
  executedQueries.length = 0;
  resultQueue.length = 0;
});

describe('agent/voice/scanners — scanSpeedToLead', () => {
  it('disabled policy -> 0, no per-org query issued', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ speedToLead: { enabled: false } })]);

    const n = await scanSpeedToLead();

    expect(n).toBe(0);
    expect(executedQueries).toHaveLength(1); // only the agent_configs read
    expect(queueOutboundCallMock).not.toHaveBeenCalled();
  });

  it('queues one call per eligible lead and reports the count', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ speedToLead: { enabled: true, delayMinutes: 2, sources: ['manual'], staleAfterHours: 12 } })]);
    push([{ id: 'lead-1' }, { id: 'lead-2' }]);
    queueOutboundCallMock.mockResolvedValueOnce('call-1').mockResolvedValueOnce(null); // second is a dedupe hit

    const n = await scanSpeedToLead();

    expect(n).toBe(1);
    expect(queueOutboundCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', leadId: 'lead-1', purpose: 'speed_to_lead', dedupeKey: 'stl:lead-1' }),
    );
  });

  it('the eligible-leads query filters on the unverified-phone rule and has no LIMIT', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ speedToLead: { enabled: true, delayMinutes: 2, sources: ['manual'], staleAfterHours: 12 } })]);
    push([]);

    await scanSpeedToLead();

    const leadsQuery = executedQueries.find((q) => sqlText(q).includes('FROM crm_leads'));
    expect(leadsQuery).toBeDefined();
    const text = sqlText(leadsQuery!);
    expect(text).toContain("phoneVerified') IS DISTINCT FROM 'false'");
    expect(text.toLowerCase()).not.toMatch(/\blimit\b/);
  });

  it('item 6: the eligible-leads query only targets the demand pipeline', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ speedToLead: { enabled: true, delayMinutes: 2, sources: ['manual'], staleAfterHours: 12 } })]);
    push([]);

    await scanSpeedToLead();

    const leadsQuery = executedQueries.find((q) => sqlText(q).includes('FROM crm_leads'));
    expect(sqlText(leadsQuery!)).toContain("pipeline = 'demand'");
  });

  it('a delay that closes the window (delayMinutes=60 >= 60-min hard window) skips the org', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ speedToLead: { enabled: true, delayMinutes: 60, sources: ['manual'], staleAfterHours: 1 } })]);
    // effectiveStart (now-60min) >= windowEnd (now-60min): the scanner must skip the org
    // entirely without issuing the leads query.
    const n = await scanSpeedToLead();

    expect(n).toBe(0);
    expect(executedQueries).toHaveLength(1); // only agent_configs — the per-org query was never issued
  });
});

describe('agent/voice/scanners — scanVisitConfirmationCalls', () => {
  it('disabled policy -> 0', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ visitConfirmation: { enabled: false } })]);

    const n = await scanVisitConfirmationCalls();

    expect(n).toBe(0);
    expect(queueOutboundCallMock).not.toHaveBeenCalled();
  });

  it('queues visit_confirmation with the visitId and dedupe key', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ visitConfirmation: { enabled: true, hoursBefore: 20 } })]);
    push([{ id: 'visit-1', lead_id: 'lead-9' }]);
    queueOutboundCallMock.mockResolvedValueOnce('call-1');

    const n = await scanVisitConfirmationCalls();

    expect(n).toBe(1);
    expect(queueOutboundCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', leadId: 'lead-9', purpose: 'visit_confirmation', visitId: 'visit-1', dedupeKey: 'vc:visit-1' }),
    );
  });
});

describe('agent/voice/scanners — scanReactivationCalls', () => {
  it('disabled policy -> 0', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ reactivation: { enabled: false } })]);

    const n = await scanReactivationCalls();

    expect(n).toBe(0);
    expect(queueOutboundCallMock).not.toHaveBeenCalled();
  });

  it('caps queued calls at maxPerRun (no SQL LIMIT — sliced in JS)', async () => {
    push([VOICE_ENABLED_CONFIG_ROW({ reactivation: { enabled: true, coldAfterDays: 14, minDaysBetween: 30, maxPerRun: 1 } })]);
    push([{ id: 'lead-1' }, { id: 'lead-2' }]);
    queueOutboundCallMock.mockResolvedValue('call-x');

    const n = await scanReactivationCalls();

    expect(n).toBe(1);
    expect(queueOutboundCallMock).toHaveBeenCalledTimes(1);
    const leadsQuery = executedQueries.find((q) => sqlText(q).includes('FROM crm_leads'));
    expect(sqlText(leadsQuery!).toLowerCase()).not.toMatch(/\blimit\b/);
  });
});
