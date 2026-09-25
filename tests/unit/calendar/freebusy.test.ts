/**
 * Unit tests for src/lib/calendar/freebusy.ts (item B, blueprint §3.9).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetValidAccessToken = vi.fn(async () => 'access-token');
const mockListConnections = vi.fn();

vi.mock('@/lib/calendar/connections', () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
  listConnections: (...args: unknown[]) => mockListConnections(...args),
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const registerBusyIntervalProviderMock = vi.fn();
vi.mock('@/lib/agent/visits/availability', () => ({
  registerBusyIntervalProvider: (...args: unknown[]) => registerBusyIntervalProviderMock(...args),
}));

import { clearFreeBusyCache, googleFreeBusyProvider, registerGoogleFreeBusyProvider } from '@/lib/calendar/freebusy';
import { CalendarAuthError } from '@/lib/calendar/types';

function conn(overrides: Partial<{ id: string; profileId: string; status: string; freebusyEnabled: boolean; calendarId: string }> = {}) {
  return {
    id: 'conn-1',
    orgId: 'org-1',
    profileId: 'advisor-1',
    googleEmail: 'a@gmail.com',
    calendarId: 'primary',
    status: 'active' as const,
    freebusyEnabled: true,
    writeEvents: true,
    lastSyncedAt: null,
    lastError: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearFreeBusyCache();
  mockGetValidAccessToken.mockImplementation(async () => 'access-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FROM = new Date('2026-06-01T00:00:00Z');
const TO = new Date('2026-06-08T00:00:00Z');

describe('googleFreeBusyProvider', () => {
  it('maps Google busy intervals for a connected, freebusy-enabled advisor', async () => {
    mockListConnections.mockResolvedValue([conn()]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { primary: { busy: [{ start: '2026-06-02T10:00:00Z', end: '2026-06-02T11:00:00Z' }] } },
    }), { status: 200 })));

    const result = await googleFreeBusyProvider({ orgId: 'org-1', profileIds: ['advisor-1'], from: FROM, to: TO });
    expect(result.get('advisor-1')).toEqual([{ start: new Date('2026-06-02T10:00:00Z'), end: new Date('2026-06-02T11:00:00Z') }]);
  });

  it('blocks the full range for that advisor only on a transient error', async () => {
    mockListConnections.mockResolvedValue([conn({ id: 'conn-1', profileId: 'advisor-1' }), conn({ id: 'conn-2', profileId: 'advisor-2' })]);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      // advisor-1 fails, advisor-2 succeeds
      const accessToken = (init?.headers as Record<string, string>)?.Authorization;
      void url;
      void accessToken;
      return new Response('boom', { status: 500 });
    }));
    mockGetValidAccessToken.mockImplementation(async (connectionId: string) => `token-for-${connectionId}`);

    const result = await googleFreeBusyProvider({ orgId: 'org-1', profileIds: ['advisor-1', 'advisor-2'], from: FROM, to: TO });
    expect(result.get('advisor-1')).toEqual([{ start: FROM, end: TO }]);
    expect(result.get('advisor-2')).toEqual([{ start: FROM, end: TO }]);
  });

  it('omits a revoked advisor entirely (fail-open)', async () => {
    mockListConnections.mockResolvedValue([conn()]);
    mockGetValidAccessToken.mockImplementation(async () => { throw new CalendarAuthError(); });

    const result = await googleFreeBusyProvider({ orgId: 'org-1', profileIds: ['advisor-1'], from: FROM, to: TO });
    expect(result.has('advisor-1')).toBe(false);
  });

  it('caches results for the same connection/range', async () => {
    mockListConnections.mockResolvedValue([conn()]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await googleFreeBusyProvider({ orgId: 'org-1', profileIds: ['advisor-1'], from: FROM, to: TO });
    await googleFreeBusyProvider({ orgId: 'org-1', profileIds: ['advisor-1'], from: FROM, to: TO });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips advisors without an eligible connection', async () => {
    mockListConnections.mockResolvedValue([conn({ freebusyEnabled: false })]);
    const result = await googleFreeBusyProvider({ orgId: 'org-1', profileIds: ['advisor-1'], from: FROM, to: TO });
    expect(result.size).toBe(0);
  });
});

describe('registerGoogleFreeBusyProvider', () => {
  it('registers idempotently', () => {
    registerGoogleFreeBusyProvider();
    registerGoogleFreeBusyProvider();
    expect(registerBusyIntervalProviderMock).toHaveBeenCalledTimes(1);
    expect(registerBusyIntervalProviderMock).toHaveBeenCalledWith('google-freebusy', expect.any(Function));
  });
});
