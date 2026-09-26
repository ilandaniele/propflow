/**
 * Unit tests for /dashboard/agent/settings's Server Actions (item D).
 *
 * Covers:
 * - unauthenticated -> UNAUTHORIZED
 * - each schema rejects bad input (timezone, FAQ overflow, numeric caps)
 * - updateAgentConfig is called with ctx.orgId only (IDOR — never trusts a
 *   client-supplied org id, since these actions don't even accept one)
 * - voiceEnabled without a configured voice number -> VALIDATION
 * - removing a caller_request DNC entry -> FORBIDDEN
 * - the web channel flag is never touched by saveAgentLimits
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440020';

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
};

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (mockState.adminRole !== 'admin') throw new Error('UNAUTHORIZED');
    return { userId: 'admin-uuid', orgId: ORG_UUID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockUpdateAgentConfig = vi.fn();
vi.mock('@/lib/agent/config', () => ({
  updateAgentConfig: (...a: unknown[]) => mockUpdateAgentConfig(...a),
}));

const mockGetOrgVoiceChannel = vi.fn();
vi.mock('@/lib/agent/voice/calls', () => ({
  getOrgVoiceChannel: (...a: unknown[]) => mockGetOrgVoiceChannel(...a),
}));

const mockAddDoNotCall = vi.fn();
const mockRemoveDoNotCall = vi.fn();
vi.mock('@/lib/agent/voice/dnc', () => ({
  addDoNotCall: (...a: unknown[]) => mockAddDoNotCall(...a),
  removeDoNotCall: (...a: unknown[]) => mockRemoveDoNotCall(...a),
}));

import {
  saveAgentIdentity,
  saveAgentKnowledge,
  saveAgentBusinessHours,
  saveAgentFollowupPolicy,
  saveAgentLimits,
  saveAgentVoiceConfig,
  addDoNotCallNumber,
  removeDoNotCallNumber,
} from '@/app/actions/agent-settings';

const VALID_IDENTITY = { persona: 'Sofía', tone: 'cercano' as const, timezone: 'America/Lima' };
const VALID_KNOWLEDGE = { rules: null, prohibited: null, faq: [], qualificationFields: ['operation_type'] as const };
const VALID_HOURS = { weekly: [{ weekday: 1, startMinute: 540, endMinute: 1140 }], closedNote: null };
const VALID_FOLLOWUP = {
  enabled: true,
  steps: [{ afterMinutes: 60, kind: 'text' as const }],
  sendWindow: { startMinute: 540, endMinute: 1200 },
  listingAlerts: { enabled: false, coldAfterDays: 7, minDaysBetween: 7, maxPerOrgPerRun: 200, template: 'x' },
};
const VALID_LIMITS = {
  whatsappEnabled: true,
  voiceEnabled: false,
  dailyTokenBudget: 100_000,
  shadowMode: false,
  maxAgentTurns: null,
  maxActiveVisitsPerPhone: 2,
  maxListingPhotos: 5,
};
const VALID_VOICE = {
  voiceProvider: 'azure' as const,
  voiceId: 'es-PE-CamilaNeural',
  language: 'es' as const,
  recordingEnabled: true,
  greetingExtra: null,
  maxCallMinutes: 10,
  monthlyMinuteCap: 300,
  callWindow: { weekdays: [1, 2, 3, 4, 5, 6], startMinute: 540, endMinute: 1200 },
  speedToLead: { enabled: false, delayMinutes: 2, sources: ['manual' as const], staleAfterHours: 12 },
  visitConfirmation: { enabled: false, hoursBefore: 20 },
  reactivation: { enabled: false, coldAfterDays: 14, minDaysBetween: 30, maxPerRun: 20 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockUpdateAgentConfig.mockResolvedValue({});
  mockGetOrgVoiceChannel.mockResolvedValue({ orgId: ORG_UUID, channelId: 'c1', phoneNumberId: 'pn1', displayPhoneE164: '+51999999999' });
  mockAddDoNotCall.mockResolvedValue(undefined);
  mockRemoveDoNotCall.mockResolvedValue('removed');
});

describe('agent-settings actions — auth', () => {
  it.each([
    ['saveAgentIdentity', () => saveAgentIdentity(VALID_IDENTITY)],
    ['saveAgentKnowledge', () => saveAgentKnowledge(VALID_KNOWLEDGE)],
    ['saveAgentBusinessHours', () => saveAgentBusinessHours(VALID_HOURS)],
    ['saveAgentFollowupPolicy', () => saveAgentFollowupPolicy(VALID_FOLLOWUP)],
    ['saveAgentLimits', () => saveAgentLimits(VALID_LIMITS)],
    ['saveAgentVoiceConfig', () => saveAgentVoiceConfig(VALID_VOICE)],
    ['addDoNotCallNumber', () => addDoNotCallNumber({ phone: '+51987654321' })],
    ['removeDoNotCallNumber', () => removeDoNotCallNumber({ phone: '+51987654321' })],
  ])('%s rejects a non-admin', async (_name, call) => {
    mockState.adminRole = 'tenant';
    const result = await call();
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('rate-limits saveAgentIdentity', async () => {
    mockState.rateLimitSuccess = false;
    const result = await saveAgentIdentity(VALID_IDENTITY);
    expect(result.error?.code).toBe('RATE_LIMITED');
  });
});

describe('saveAgentIdentity — validation', () => {
  it('rejects an invalid IANA timezone', async () => {
    const result = await saveAgentIdentity({ ...VALID_IDENTITY, timezone: 'Not/AZone' });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
  });

  it('rejects a persona shorter than 2 chars', async () => {
    const result = await saveAgentIdentity({ ...VALID_IDENTITY, persona: 'A' });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('scopes the update to the caller\'s own org (IDOR)', async () => {
    const result = await saveAgentIdentity(VALID_IDENTITY);
    expect(result.error).toBeUndefined();
    expect(mockUpdateAgentConfig).toHaveBeenCalledWith(ORG_UUID, expect.objectContaining(VALID_IDENTITY));
  });
});

describe('saveAgentKnowledge — validation', () => {
  it('rejects more than 50 FAQ entries', async () => {
    const faq = Array.from({ length: 51 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const result = await saveAgentKnowledge({ ...VALID_KNOWLEDGE, faq });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
  });

  it('rejects an empty qualificationFields array', async () => {
    const result = await saveAgentKnowledge({ ...VALID_KNOWLEDGE, qualificationFields: [] });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown qualification field', async () => {
    const result = await saveAgentKnowledge({ ...VALID_KNOWLEDGE, qualificationFields: ['not_a_field'] as unknown as string[] });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('saveAgentBusinessHours — validation', () => {
  it('rejects a range where endMinute <= startMinute', async () => {
    const result = await saveAgentBusinessHours({ weekly: [{ weekday: 1, startMinute: 600, endMinute: 500 }], closedNote: null });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a closedNote over 300 chars', async () => {
    const result = await saveAgentBusinessHours({ weekly: [], closedNote: 'x'.repeat(301) });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('saveAgentFollowupPolicy — validation', () => {
  it('rejects more than 5 steps', async () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({ afterMinutes: (i + 1) * 60, kind: 'text' as const }));
    const result = await saveAgentFollowupPolicy({ ...VALID_FOLLOWUP, steps });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
  });

  it('rejects non-increasing step minutes', async () => {
    const steps = [
      { afterMinutes: 120, kind: 'text' as const },
      { afterMinutes: 60, kind: 'text' as const },
    ];
    const result = await saveAgentFollowupPolicy({ ...VALID_FOLLOWUP, steps });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
  });

  it('accepts strictly increasing steps within the cap', async () => {
    const result = await saveAgentFollowupPolicy(VALID_FOLLOWUP);
    expect(result.error).toBeUndefined();
  });
});

describe('saveAgentLimits', () => {
  it('rejects dailyTokenBudget outside 1000..5,000,000', async () => {
    const result = await saveAgentLimits({ ...VALID_LIMITS, dailyTokenBudget: 100 });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects enabling voice without a configured voice number', async () => {
    mockGetOrgVoiceChannel.mockResolvedValueOnce(null);
    const result = await saveAgentLimits({ ...VALID_LIMITS, voiceEnabled: true });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateAgentConfig).not.toHaveBeenCalled();
  });

  it('allows enabling voice when a voice number exists', async () => {
    const result = await saveAgentLimits({ ...VALID_LIMITS, voiceEnabled: true });
    expect(result.error).toBeUndefined();
    expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
      ORG_UUID,
      expect.objectContaining({ channels: { whatsapp: true, voice: true } })
    );
  });

  it('never touches the web channel flag', async () => {
    await saveAgentLimits(VALID_LIMITS);
    const patch = mockUpdateAgentConfig.mock.calls[0][1];
    expect(patch.channels).not.toHaveProperty('web');
  });
});

describe('saveAgentVoiceConfig — validation', () => {
  it('rejects maxCallMinutes outside 1..30', async () => {
    const result = await saveAgentVoiceConfig({ ...VALID_VOICE, maxCallMinutes: 0 });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid config and scopes the update to ctx.orgId', async () => {
    const result = await saveAgentVoiceConfig(VALID_VOICE);
    expect(result.error).toBeUndefined();
    expect(mockUpdateAgentConfig).toHaveBeenCalledWith(ORG_UUID, { voice: VALID_VOICE });
  });
});

describe('addDoNotCallNumber', () => {
  it('rejects a malformed phone', async () => {
    const result = await addDoNotCallNumber({ phone: 'not-a-phone' });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockAddDoNotCall).not.toHaveBeenCalled();
  });

  it('normalizes and adds a valid E.164 phone, scoped to the org', async () => {
    const result = await addDoNotCallNumber({ phone: '+51 987 654 321' });
    expect(result.error).toBeUndefined();
    expect(mockAddDoNotCall).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_UUID, phoneE164: '+51987654321', source: 'staff' })
    );
  });
});

describe('removeDoNotCallNumber', () => {
  it('returns FORBIDDEN for a caller_request entry', async () => {
    mockRemoveDoNotCall.mockResolvedValueOnce('protected');
    const result = await removeDoNotCallNumber({ phone: '+51987654321' });
    expect(result.error?.code).toBe('FORBIDDEN');
  });

  it('succeeds for a staff-added entry', async () => {
    const result = await removeDoNotCallNumber({ phone: '+51987654321' });
    expect(result.error).toBeUndefined();
    expect(mockRemoveDoNotCall).toHaveBeenCalledWith(ORG_UUID, '+51987654321');
  });
});
