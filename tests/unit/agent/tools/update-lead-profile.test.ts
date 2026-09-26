import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createProspectLead, applyLeadQualification, setSessionLead } = vi.hoisted(() => ({
  createProspectLead: vi.fn(async (args: { orgId: string; fullName: string; phone: string | null }) => ({
    id: 'lead-new',
    fullName: args.fullName,
    phone: args.phone,
    score: 0,
    intentTag: null,
  })),
  applyLeadQualification: vi.fn(async (_orgId: string, leadId: string, _patch: unknown) => ({
    id: leadId,
    score: 42,
    intentTag: 'qualified',
  })),
  setSessionLead: vi.fn(async () => {}),
}));

vi.mock('@/lib/agent/lead', () => ({
  createProspectLead,
  applyLeadQualification,
  attributionToSource: (a: unknown) =>
    a ? { sourceRef: 'ref:X', sourceMeta: a as Record<string, unknown> } : { sourceRef: null, sourceMeta: {} },
}));
vi.mock('@/lib/agent/session', () => ({ setSessionLead }));

import { makeUpdateLeadProfileTool } from '@/lib/agent/tools/update-lead-profile';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    orgId: 'org-1',
    sessionId: 'session-1',
    channel: 'whatsapp',
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: null },
    attribution: null,
    ...overrides,
  };
}

describe('update_lead_profile tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dryRun: describes what would happen and never touches the DB', async () => {
    const ctx = makeCtx({ dryRun: true });
    const tool = makeUpdateLeadProfileTool(ctx);

    const result = await tool.run({ zones: ['Miraflores'], budgetMax: 1500 });

    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(createProspectLead).not.toHaveBeenCalled();
    expect(applyLeadQualification).not.toHaveBeenCalled();
  });

  it('creates the lead on first write for a WhatsApp session, using externalId as the phone', async () => {
    const ctx = makeCtx();
    const tool = makeUpdateLeadProfileTool(ctx);

    await tool.run({ operationType: 'rent' });

    expect(createProspectLead).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', phone: '+51987654321', sourceChannel: 'whatsapp' })
    );
    expect(setSessionLead).toHaveBeenCalledWith('session-1', 'lead-new');
    expect(ctx.leadIdRef.current).toBe('lead-new');
    expect(applyLeadQualification).toHaveBeenCalledWith('org-1', 'lead-new', expect.objectContaining({ operationType: 'rent' }));
  });

  it('does not create a lead for a web session with no phone yet', async () => {
    const ctx = makeCtx({ channel: 'web', externalId: 'widget-session-abc' });
    const tool = makeUpdateLeadProfileTool(ctx);

    await tool.run({ operationType: 'buy' });

    expect(createProspectLead).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
  });

  it('derives sourceRef/sourceMeta from the session attribution on lead creation', async () => {
    const attribution = { type: 'ctwa', sourceId: 'ad-1', capturedAt: '2026-01-01T00:00:00.000Z' };
    const ctx = makeCtx({ attribution });
    const tool = makeUpdateLeadProfileTool(ctx);

    await tool.run({ operationType: 'rent' });

    expect(createProspectLead).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'ref:X', sourceMeta: attribution }),
    );
  });

  it('reuses the existing leadId instead of creating a new one', async () => {
    const ctx = makeCtx({ leadIdRef: { current: 'lead-existing' } });
    const tool = makeUpdateLeadProfileTool(ctx);

    await tool.run({ zones: ['San Isidro'] });

    expect(createProspectLead).not.toHaveBeenCalled();
    expect(applyLeadQualification).toHaveBeenCalledWith('org-1', 'lead-existing', expect.anything());
  });

  it('reports the deterministic score and intent tag back to the model', async () => {
    const ctx = makeCtx({ leadIdRef: { current: 'lead-existing' } });
    const tool = makeUpdateLeadProfileTool(ctx);

    const result = await tool.run({ zones: ['X'] });

    expect(String(result)).toContain('42');
    expect(String(result)).toContain('qualified');
  });
});
