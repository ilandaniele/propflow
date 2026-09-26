import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setSessionMode, createProspectLead } = vi.hoisted(() => ({
  setSessionMode: vi.fn(async () => {}),
  createProspectLead: vi.fn(async () => ({ id: 'lead-owner-1' })),
}));

vi.mock('@/lib/agent/session', () => ({ setSessionMode }));
vi.mock('@/lib/agent/lead', () => ({ createProspectLead }));

import { makeHandoffToHumanTool } from '@/lib/agent/tools/handoff-to-human';
import { makeRegisterOwnerLeadTool } from '@/lib/agent/tools/register-owner-lead';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    orgId: 'org-1',
    sessionId: 'session-1',
    channel: 'whatsapp',
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: 'lead-1' },
    ...overrides,
  };
}

describe('handoff_to_human tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dryRun never pauses the real session', async () => {
    const tool = makeHandoffToHumanTool(makeCtx({ dryRun: true }));
    const result = await tool.run({ reason: 'wants_human', summary: 'Quiere hablar con alguien' });
    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(setSessionMode).not.toHaveBeenCalled();
  });

  it('sets the session to human mode with the model-provided summary', async () => {
    const tool = makeHandoffToHumanTool(makeCtx());
    await tool.run({ reason: 'complaint', summary: 'Reclamo por ruido' });
    expect(setSessionMode).toHaveBeenCalledWith('session-1', 'human', 'Reclamo por ruido');
  });
});

describe('register_owner_lead tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dryRun never creates a real lead', async () => {
    const tool = makeRegisterOwnerLeadTool(makeCtx({ dryRun: true }));
    const result = await tool.run({ fullName: 'Doña Rosa', operationType: 'owner_sell' });
    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(createProspectLead).not.toHaveBeenCalled();
  });

  it('creates a SEPARATE supply-pipeline lead, not linked to the session leadIdRef', async () => {
    const ctx = makeCtx({ leadIdRef: { current: 'lead-existing-demand-side' } });
    const tool = makeRegisterOwnerLeadTool(ctx);

    await tool.run({ fullName: 'Doña Rosa', operationType: 'owner_rent', zone: 'Surco' });

    expect(createProspectLead).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline: 'supply', operationType: 'owner_rent', zones: ['Surco'] })
    );
    // The tool never mutates leadIdRef — the demand-side lead stays untouched.
    expect(ctx.leadIdRef.current).toBe('lead-existing-demand-side');
  });

  it('falls back to the session phone when no explicit phone is given', async () => {
    const tool = makeRegisterOwnerLeadTool(makeCtx());
    await tool.run({ fullName: 'Don Pepe', operationType: 'owner_sell' });
    expect(createProspectLead).toHaveBeenCalledWith(expect.objectContaining({ phone: '+51987654321' }));
  });
});
