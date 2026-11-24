/**
 * Integration tests for POST /api/cron/agent-dispatch (drain) and
 * POST /api/cron/agent-dispatch?sweep=1 (sweep).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const drainAgentJobs = vi.fn();
const sweepStalePendingInbound = vi.fn();
const ensureCalendarSyncJobs = vi.fn();
const scanSpeedToLead = vi.fn();
const scanVisitConfirmationCalls = vi.fn();
const failStaleCalls = vi.fn();
const syncDueUnitCalendars = vi.fn();

vi.mock('@/lib/agent/jobs', () => ({ drainAgentJobs: (...a: unknown[]) => drainAgentJobs(...a) }));
vi.mock('@/lib/agent/job-handlers', () => ({ registerAgentJobHandlers: vi.fn() }));
vi.mock('@/lib/agent/whatsapp-dispatch', () => ({ sweepStalePendingInbound: () => sweepStalePendingInbound() }));
vi.mock('@/lib/calendar/sync', () => ({ ensureCalendarSyncJobs: () => ensureCalendarSyncJobs() }));
vi.mock('@/lib/agent/voice/scanners', () => ({
  scanSpeedToLead: () => scanSpeedToLead(),
  scanVisitConfirmationCalls: () => scanVisitConfirmationCalls(),
}));
vi.mock('@/lib/agent/voice/usage', () => ({ failStaleCalls: () => failStaleCalls() }));
vi.mock('@/lib/unit-calendar/sync', () => ({ syncDueUnitCalendars: () => syncDueUnitCalendars() }));
vi.mock('@/lib/db/retry', () => ({ withDbRetry: (fn: () => Promise<unknown>) => fn() }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const SECRET = 'test-cron-secret';

function cronRequest(query = '', auth = `Bearer ${SECRET}`): NextRequest {
  return new NextRequest(`http://localhost/api/cron/agent-dispatch${query}`, {
    method: 'POST',
    headers: { authorization: auth },
  });
}

async function callRoute(request: NextRequest) {
  const { POST } = await import('@/app/api/cron/agent-dispatch/route');
  return POST(request);
}

describe('POST /api/cron/agent-dispatch', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET);
    drainAgentJobs.mockResolvedValue({ claimed: 2, done: 2, failed: 0 });
    sweepStalePendingInbound.mockResolvedValue(1);
    ensureCalendarSyncJobs.mockResolvedValue(2);
    scanSpeedToLead.mockResolvedValue(3);
    scanVisitConfirmationCalls.mockResolvedValue(4);
    failStaleCalls.mockResolvedValue(5);
    syncDueUnitCalendars.mockResolvedValue(6);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('401 on a bad secret', async () => {
    const res = await callRoute(cronRequest('', 'Bearer wrong'));
    expect(res.status).toBe(401);
    expect(drainAgentJobs).not.toHaveBeenCalled();
  });

  it('503 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await callRoute(cronRequest());
    expect(res.status).toBe(503);
  });

  it('drains without running the sweep', async () => {
    const res = await callRoute(cronRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', claimed: 2, done: 2, failed: 0 });
    expect(drainAgentJobs).toHaveBeenCalledWith(50);
    expect(sweepStalePendingInbound).not.toHaveBeenCalled();
    expect(scanSpeedToLead).not.toHaveBeenCalled();
  });

  it('?sweep=1 runs every sweep step and does not drain', async () => {
    const res = await callRoute(cronRequest('?sweep=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      staleInboundSwept: 1,
      calendarSyncsEnqueued: 2,
      speedToLeadCalls: 3,
      visitConfirmationCalls: 4,
      staleCallsFailed: 5,
      unitCalendarsSynced: 6,
      failed: 0,
    });
    expect(drainAgentJobs).not.toHaveBeenCalled();
  });

  it('?sweep=1 keeps going when a step throws', async () => {
    sweepStalePendingInbound.mockRejectedValue(new Error('db down'));
    scanSpeedToLead.mockRejectedValue(new Error('db down'));
    const res = await callRoute(cronRequest('?sweep=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ staleInboundSwept: 0, speedToLeadCalls: 0, visitConfirmationCalls: 4, staleCallsFailed: 5, failed: 2 });
    expect(ensureCalendarSyncJobs).toHaveBeenCalled();
    expect(failStaleCalls).toHaveBeenCalled();
  });

  it('500 when the drain throws', async () => {
    drainAgentJobs.mockRejectedValue(new Error('db down'));
    const res = await callRoute(cronRequest());
    expect(res.status).toBe(500);
  });
});
