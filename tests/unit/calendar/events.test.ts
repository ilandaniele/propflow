/**
 * Unit tests for src/lib/calendar/google/events.ts (item B, blueprint §3.9).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetValidAccessToken = vi.fn(async () => 'access-token');

vi.mock('@/lib/calendar/connections', () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
}));

import { buildVisitEvent, eventIdForVisit, insertEvent, listEventsPage, sanitizeForCalendar } from '@/lib/calendar/google/events';
import type { VisitRecord } from '@/lib/agent/visits/types';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetValidAccessToken.mockImplementation(async () => 'access-token');
});

// ─── eventIdForVisit ─────────────────────────────────────────────────────────

describe('eventIdForVisit', () => {
  it('matches Google\'s event-id charset and is deterministic', () => {
    const id1 = eventIdForVisit('550e8400-e29b-41d4-a716-446655440000');
    const id2 = eventIdForVisit('550e8400-e29b-41d4-a716-446655440000');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it('differs for different visit ids', () => {
    const id1 = eventIdForVisit('550e8400-e29b-41d4-a716-446655440000');
    const id2 = eventIdForVisit('550e8400-e29b-41d4-a716-446655440001');
    expect(id1).not.toBe(id2);
  });
});

// ─── sanitizeForCalendar ─────────────────────────────────────────────────────

describe('sanitizeForCalendar', () => {
  it('strips C0/C1 control chars and collapses whitespace', () => {
    expect(sanitizeForCalendar('hello\x00\x1f\tworld\n\n', 100)).toBe('hello world');
  });

  it('caps length', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeForCalendar(long, 50).length).toBe(50);
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeForCalendar(null, 10)).toBe('');
    expect(sanitizeForCalendar(undefined, 10)).toBe('');
  });

  it('HTML-escapes & < > " \' so the description cannot inject markup', () => {
    expect(sanitizeForCalendar(`<script>alert("x")</script> & 'quote'`, 200)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;',
    );
  });
});

// ─── buildVisitEvent ─────────────────────────────────────────────────────────

function makeVisit(overrides: Partial<VisitRecord> = {}): VisitRecord {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    orgId: 'org-1',
    leadId: 'lead-1',
    listingId: 'listing-1',
    profileId: 'profile-1',
    sessionId: null,
    contactPhone: '+51999888777',
    startsAt: new Date('2026-06-01T15:00:00Z'),
    endsAt: new Date('2026-06-01T15:45:00Z'),
    blockedUntil: new Date('2026-06-01T16:00:00Z'),
    status: 'scheduled',
    createdBy: 'agent',
    sourceChannel: 'whatsapp',
    rescheduledFromId: null,
    feedback: null,
    notes: 'llamar antes de llegar',
    listingTitle: 'Depa en Miraflores',
    advisorName: 'Ana Advisor',
    leadName: 'Juan Lead',
    ...overrides,
  };
}

describe('buildVisitEvent', () => {
  it('never includes the phone, contact info or free-text notes', () => {
    const body = buildVisitEvent(makeVisit(), { timeZone: 'America/Lima', dashboardUrl: 'https://app.test', includeId: true });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('+51999888777');
    expect(serialized).not.toContain('llamar antes de llegar');
  });

  it('uses the given timeZone on both start and end', () => {
    const body = buildVisitEvent(makeVisit(), { timeZone: 'America/Lima', dashboardUrl: 'https://app.test', includeId: false });
    expect(body.start.timeZone).toBe('America/Lima');
    expect(body.end.timeZone).toBe('America/Lima');
    expect(body.id).toBeUndefined();
  });

  it('includes the deterministic id only when includeId is true', () => {
    const visit = makeVisit();
    const body = buildVisitEvent(visit, { timeZone: 'America/Lima', dashboardUrl: 'https://app.test', includeId: true });
    expect(body.id).toBe(eventIdForVisit(visit.id));
  });

  it('carries pfVisitId/pfOrgId as extended private props', () => {
    const visit = makeVisit();
    const body = buildVisitEvent(visit, { timeZone: 'America/Lima', dashboardUrl: 'https://app.test', includeId: false });
    expect(body.extendedProperties.private).toEqual({ pfVisitId: visit.id, pfOrgId: visit.orgId });
  });
});

// ─── insertEvent: 409 falls back to patch ───────────────────────────────────

describe('insertEvent', () => {
  it('falls back to patch on a 409 conflict', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { errors: [{ reason: 'duplicate' }] } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'pfvabc', etag: '"etag-1"' }), { status: 200 })));

    const body = buildVisitEvent(makeVisit(), { timeZone: 'America/Lima', dashboardUrl: 'https://app.test', includeId: true });
    const result = await insertEvent('conn-1', 'primary', body);

    expect(result).toEqual({ id: 'pfvabc', etag: '"etag-1"' });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain(`/events/${body.id}`);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondCallInit.method).toBe('PATCH');
    vi.unstubAllGlobals();
  });
});

// ─── listEventsPage: timeMin only on an initial full sync ──────────────────

describe('listEventsPage', () => {
  it('sends timeMin when there is no syncToken and no pageToken', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const timeMin = new Date('2026-05-01T00:00:00Z');
    await listEventsPage('conn-1', 'primary', { timeMin });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('timeMin')).toBe(timeMin.toISOString());
    vi.unstubAllGlobals();
  });

  it('omits timeMin once a syncToken is present', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listEventsPage('conn-1', 'primary', { syncToken: 'tok', timeMin: new Date() });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.has('timeMin')).toBe(false);
    expect(url.searchParams.get('syncToken')).toBe('tok');
    vi.unstubAllGlobals();
  });
});
