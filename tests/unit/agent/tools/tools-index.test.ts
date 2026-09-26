import { describe, it, expect, vi, beforeEach } from 'vitest';

// buildAgentTools wires every real tool factory; stub every module they
// import so this file exercises only the channel filter in index.ts, not
// each tool's own DB/behaviour (that's each tool's own test file's job).
vi.mock('@/lib/agent/listings', () => ({ searchListings: vi.fn(), getListingDetails: vi.fn() }));
vi.mock('@/lib/agent/session-listings', () => ({ rememberSessionListings: vi.fn(), isListingKnownToSession: vi.fn() }));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig: vi.fn(async () => ({ maxListingPhotos: 5, timezone: 'America/Lima' })) }));
vi.mock('@/lib/agent/outbound', () => ({ sendWhatsAppImage: vi.fn(), sendWhatsAppText: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getSignedUrl: vi.fn() }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent: vi.fn() }));
vi.mock('@/lib/agent/session', () => ({ setSessionMode: vi.fn(), setSessionLead: vi.fn() }));
vi.mock('@/lib/agent/lead', () => ({
  createProspectLead: vi.fn(),
  applyLeadQualification: vi.fn(),
  attributionToSource: vi.fn(() => ({ sourceRef: null, sourceMeta: {} })),
}));
vi.mock('@/lib/agent/visits/availability', () => ({ getAvailableSlotsForOrg: vi.fn(), isSlotStillAvailable: vi.fn() }));
vi.mock('@/lib/agent/visits/service', () => ({
  bookVisit: vi.fn(), rescheduleVisit: vi.fn(), cancelVisit: vi.fn(), listLeadActiveVisits: vi.fn(), getVisit: vi.fn(), confirmVisit: vi.fn(),
}));
vi.mock('@/lib/widget/handoff-codes', () => ({ createHandoffCode: vi.fn() }));
vi.mock('@/lib/agent/voice/dnc', () => ({ addDoNotCall: vi.fn() }));
vi.mock('@/lib/widget/web-session', () => ({ setWebSessionPhone: vi.fn() }));
vi.mock('@/lib/widget/channel', () => ({ getWhatsAppDisplayPhone: vi.fn(), E164_RE: /^\+[1-9]\d{6,14}$/ }));
vi.mock('@/lib/whatsapp/phone', () => ({ toE164: vi.fn((p: string) => p) }));
vi.mock('@/lib/db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })) },
}));

import { buildAgentTools } from '@/lib/agent/tools/index';
import type { AgentToolContext } from '@/lib/agent/tools/context';
import type { AgentChannel } from '@/lib/agent/session';

function makeCtx(channel: AgentChannel): AgentToolContext {
  return {
    orgId: 'org-1',
    sessionId: 'session-1',
    channel,
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: null },
    attribution: null,
    webSessionId: channel === 'web' ? 'web-session-1' : null,
    shadowMode: false,
    whatsappConversationId: channel === 'whatsapp' ? 'conv-1' : null,
    voiceCallId: channel === 'voice' ? 'call-1' : null,
  };
}

describe('buildAgentTools channel filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('voice gets no send_listing_card, send_listing_photos or continue_on_whatsapp', () => {
    const names = buildAgentTools(makeCtx('voice')).map((t) => t.name);
    expect(names).not.toContain('send_listing_card');
    expect(names).not.toContain('send_listing_photos');
    expect(names).not.toContain('continue_on_whatsapp');
    expect(names).toContain('confirm_my_visit');
    expect(names).toContain('opt_out_of_calls');
  });

  it('web gets no send_listing_photos or opt_out_of_calls', () => {
    const names = buildAgentTools(makeCtx('web')).map((t) => t.name);
    expect(names).not.toContain('send_listing_photos');
    expect(names).not.toContain('opt_out_of_calls');
    expect(names).toContain('send_listing_card');
    expect(names).toContain('continue_on_whatsapp');
  });

  it('whatsapp gets send_listing_photos but no continue_on_whatsapp', () => {
    const names = buildAgentTools(makeCtx('whatsapp')).map((t) => t.name);
    expect(names).toContain('send_listing_photos');
    expect(names).toContain('send_listing_card');
    expect(names).not.toContain('continue_on_whatsapp');
  });

  it('every returned tool name is one the channel table actually allows', async () => {
    const { isToolEnabledForChannel } = await import('@/lib/agent/tools/channels');
    for (const channel of ['whatsapp', 'web', 'voice'] as const) {
      const names = buildAgentTools(makeCtx(channel)).map((t) => t.name);
      for (const name of names) expect(isToolEnabledForChannel(name, channel)).toBe(true);
    }
  });
});
