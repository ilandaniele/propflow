/**
 * Unit tests for getAgentSetupStatus (src/lib/agent/setup-status.ts).
 *
 * Covers:
 * 1. Env presence booleans mirror process.env — and NEVER leak the actual value.
 * 2. WHATSAPP_PROVIDER presence requires the exact value 'meta'.
 * 3. org_channels(whatsapp) row → phoneNumberId/displayPhoneE164/matchesEnvPhoneNumberId.
 * 4. Last inbound WhatsApp message timestamp (null when none).
 * 5. Advisor availability / calendar connection / listing counts pass through.
 * 6. agent_configs channelsEnabled/shadowMode mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  orgChannels,
  whatsappMessages,
  agentAvailability,
  calendarConnections,
  listings,
} from '@/lib/db/schema';

// ─── db: a table-keyed chainable mock — resolves whichever table `.from()`
// was called with, regardless of chain shape (some queries end in `.limit()`,
// others (count/countDistinct) end directly on `.where()`). ─────────────────
const mockResults = new Map<unknown, unknown[]>();

function makeChain() {
  let table: unknown;
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => { table = t; return chain; };
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(mockResults.get(table) ?? []).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/db', () => ({
  db: { select: vi.fn(() => makeChain()) },
}));

const { getConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(async () => ({
    channelsEnabled: { whatsapp: false, web: false, voice: false },
    shadowMode: false,
  })),
}));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig: getConfigMock }));

import { getAgentSetupStatus } from '@/lib/agent/setup-status';

const ORG_ID = 'org-1';
const ENV_VARS = [
  'WHATSAPP_PROVIDER',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'META_APP_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'TOKEN_ENCRYPTION_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'ANTHROPIC_API_KEY',
  'VAPI_API_KEY',
  'VAPI_WEBHOOK_SECRET',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  mockResults.clear();
  getConfigMock.mockClear();
  getConfigMock.mockResolvedValue({
    channelsEnabled: { whatsapp: false, web: false, voice: false },
    shadowMode: false,
  });
  for (const key of ENV_VARS) {
    ORIGINAL_ENV[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_VARS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

describe('getAgentSetupStatus — env presence', () => {
  it('reports every var as false when unset', async () => {
    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.env).toEqual({
      whatsappProviderIsMeta: false,
      whatsappAccessToken: false,
      whatsappPhoneNumberId: false,
      whatsappBusinessAccountId: false,
      metaAppSecret: false,
      whatsappWebhookVerifyToken: false,
      tokenEncryptionKey: false,
      resendApiKey: false,
      resendFromEmail: false,
      anthropicApiKey: false,
      vapiApiKey: false,
      vapiWebhookSecret: false,
    });
  });

  it('reports presence booleans only — never the actual secret value', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'super-secret-token-value';
    process.env.RESEND_API_KEY = 're_another_secret';
    const status = await getAgentSetupStatus(ORG_ID);
    const serialized = JSON.stringify(status);
    expect(status.env.whatsappAccessToken).toBe(true);
    expect(status.env.resendApiKey).toBe(true);
    expect(serialized).not.toContain('super-secret-token-value');
    expect(serialized).not.toContain('re_another_secret');
  });

  it('WHATSAPP_PROVIDER only counts as configured when it equals exactly "meta"', async () => {
    process.env.WHATSAPP_PROVIDER = 'mock';
    let status = await getAgentSetupStatus(ORG_ID);
    expect(status.env.whatsappProviderIsMeta).toBe(false);

    process.env.WHATSAPP_PROVIDER = 'meta';
    status = await getAgentSetupStatus(ORG_ID);
    expect(status.env.whatsappProviderIsMeta).toBe(true);
  });
});

describe('getAgentSetupStatus — whatsapp channel', () => {
  it('reports unconfigured when the org has no whatsapp org_channels row', async () => {
    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.whatsappChannel).toEqual({
      configured: false,
      phoneNumberId: null,
      displayPhoneE164: null,
      matchesEnvPhoneNumberId: false,
    });
  });

  it('surfaces the bound phone number id + display phone, and flags a mismatch against env', async () => {
    mockResults.set(orgChannels, [{ externalId: '1234567890', config: { displayPhoneE164: '+51987654321' } }]);
    process.env.WHATSAPP_PHONE_NUMBER_ID = '9999999999';

    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.whatsappChannel.configured).toBe(true);
    expect(status.whatsappChannel.phoneNumberId).toBe('1234567890');
    expect(status.whatsappChannel.displayPhoneE164).toBe('+51987654321');
    expect(status.whatsappChannel.matchesEnvPhoneNumberId).toBe(false);
  });

  it('matchesEnvPhoneNumberId is true when the stored id equals the env var', async () => {
    mockResults.set(orgChannels, [{ externalId: '1234567890', config: {} }]);
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';

    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.whatsappChannel.matchesEnvPhoneNumberId).toBe(true);
  });
});

describe('getAgentSetupStatus — inbound proof, counts, agent config', () => {
  it('lastInboundWhatsAppAt is null when there is no inbound message', async () => {
    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.lastInboundWhatsAppAt).toBeNull();
  });

  it('surfaces the last inbound message timestamp', async () => {
    const when = new Date('2026-09-20T10:00:00Z');
    mockResults.set(whatsappMessages, [{ createdAt: when }]);
    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.lastInboundWhatsAppAt).toEqual(when);
  });

  it('passes through advisor availability / calendar connection / listing counts', async () => {
    mockResults.set(agentAvailability, [{ n: 3 }]);
    mockResults.set(calendarConnections, [{ n: 2 }]);
    mockResults.set(listings, [{ n: 7 }]);

    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.advisorsWithAvailability).toBe(3);
    expect(status.activeCalendarConnections).toBe(2);
    expect(status.publishedListings).toBe(7);
  });

  it('defaults counts to 0 with no rows', async () => {
    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.advisorsWithAvailability).toBe(0);
    expect(status.activeCalendarConnections).toBe(0);
    expect(status.publishedListings).toBe(0);
  });

  it('maps agent_configs channelsEnabled/shadowMode', async () => {
    getConfigMock.mockResolvedValueOnce({
      channelsEnabled: { whatsapp: true, web: false, voice: true },
      shadowMode: true,
    });
    const status = await getAgentSetupStatus(ORG_ID);
    expect(status.agent).toEqual({
      whatsappEnabled: true,
      webEnabled: false,
      voiceEnabled: true,
      shadowMode: true,
    });
  });
});
