import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getVisit, confirmVisit } = vi.hoisted(() => ({
  getVisit: vi.fn(async () => null as unknown),
  confirmVisit: vi.fn(async () => ({ id: 'visit-1', status: 'confirmed' }) as unknown),
}));

vi.mock('@/lib/agent/visits/service', () => ({ getVisit, confirmVisit }));

import { makeConfirmMyVisitTool } from '@/lib/agent/tools/confirm-my-visit';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    orgId: 'org-1',
    sessionId: 'session-1',
    channel: 'whatsapp',
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: 'lead-1' },
    attribution: null,
    webSessionId: null,
    shadowMode: false,
    whatsappConversationId: 'conv-1',
    voiceCallId: null,
    ...overrides,
  };
}

describe('confirm_my_visit tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirms a scheduled visit that belongs to this lead', async () => {
    getVisit.mockResolvedValueOnce({ id: 'visit-1', leadId: 'lead-1', status: 'scheduled' });
    const tool = makeConfirmMyVisitTool(makeCtx());
    const result = await tool.run({ visitId: 'visit-1' });
    expect(confirmVisit).toHaveBeenCalledWith('org-1', 'visit-1');
    expect(String(result)).toMatch(/confirmé/i);
  });

  it('another lead\'s visit is reported as not found, and never confirmed', async () => {
    getVisit.mockResolvedValueOnce({ id: 'visit-1', leadId: 'someone-else', status: 'scheduled' });
    const tool = makeConfirmMyVisitTool(makeCtx());
    const result = await tool.run({ visitId: 'visit-1' });
    expect(confirmVisit).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/no encontré/i);
  });

  it('a session with no known lead never even looks up the visit', async () => {
    const tool = makeConfirmMyVisitTool(makeCtx({ leadIdRef: { current: null } }));
    const result = await tool.run({ visitId: 'visit-1' });
    expect(getVisit).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/no encontré/i);
  });

  it('dryRun describes instead of confirming', async () => {
    getVisit.mockResolvedValueOnce({ id: 'visit-1', leadId: 'lead-1', status: 'scheduled' });
    const tool = makeConfirmMyVisitTool(makeCtx({ dryRun: true }));
    const result = await tool.run({ visitId: 'visit-1' });
    expect(confirmVisit).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/SIMULACIÓN/);
  });

  it('an already-confirmed visit says so and never calls confirmVisit — even in dryRun', async () => {
    getVisit.mockResolvedValueOnce({ id: 'visit-1', leadId: 'lead-1', status: 'confirmed' });
    const tool = makeConfirmMyVisitTool(makeCtx());
    const result = await tool.run({ visitId: 'visit-1' });
    expect(confirmVisit).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/ya está confirmada/i);

    getVisit.mockResolvedValueOnce({ id: 'visit-1', leadId: 'lead-1', status: 'confirmed' });
    const dryTool = makeConfirmMyVisitTool(makeCtx({ dryRun: true }));
    const dryResult = await dryTool.run({ visitId: 'visit-1' });
    expect(confirmVisit).not.toHaveBeenCalled();
    expect(String(dryResult)).toMatch(/ya está confirmada/i);
  });

  it('a visit that is neither scheduled nor confirmed (e.g. cancelled) is explained as not active', async () => {
    getVisit.mockResolvedValueOnce({ id: 'visit-1', leadId: 'lead-1', status: 'cancelled' });
    const tool = makeConfirmMyVisitTool(makeCtx());
    const result = await tool.run({ visitId: 'visit-1' });
    expect(confirmVisit).not.toHaveBeenCalled();
    expect(String(result)).not.toMatch(/confirmé/i);
  });

  it('only reports success when confirmVisit actually flips the status to confirmed', async () => {
    getVisit.mockResolvedValueOnce({ id: 'visit-1', leadId: 'lead-1', status: 'scheduled' });
    confirmVisit.mockResolvedValueOnce({ id: 'visit-1', status: 'scheduled' }); // e.g. raced to no-op
    const tool = makeConfirmMyVisitTool(makeCtx());
    const result = await tool.run({ visitId: 'visit-1' });
    expect(String(result)).not.toMatch(/listo, confirmé/i);
  });
});
