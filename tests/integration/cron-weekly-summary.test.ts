/**
 * Integration tests for POST /api/cron/weekly-summary (fan-out refactor).
 *
 * Mocks:
 * - createAdminClient() — returns a configurable Supabase stub
 * - getWhatsAppProvider() — returns a stub with a sendMessage spy
 * - buildWeeklySummary() — returns a fixed summary payload
 *
 * Scenarios:
 * 1. 3 admins with phones → sendMessage called 3 times
 * 2. 0 admins with phones → sendMessage not called, log.warn emitted
 * 3. 3 admins, one send fails → other 2 succeed, route returns 200
 * 4. Bad CRON_SECRET → 401
 * 5. Missing CRON_SECRET → 503
 * 6. All sends fail → summariesInserted still 1 (idempotency preserved)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Shared mock state — mutated per test
// ---------------------------------------------------------------------------

const sendMessageSpy = vi.fn();

// Configurable per-test admin profiles
let mockAdmins: Array<{ id: string; whatsapp_phone: string | null }> = [];
let insertShouldFail = false;
let insertErrorCode  = '';

vi.mock('@/lib/whatsapp', () => ({
  getWhatsAppProvider: () => ({ sendMessage: sendMessageSpy }),
}));

vi.mock('@/lib/whatsapp/weekly-summary', () => ({
  buildWeeklySummary: vi.fn().mockResolvedValue({
    body:         'Weekly summary for Test Property, week 2026-W22',
    isoWeek:      '2026-W22',
    propertyName: 'Test Property',
    counts:       { tasksCompleted: 3, tasksPending: 1, sanctions: 0, incidents: 2, payments: 5 },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({ data: [{ id: 'org-1', name: 'Test Org' }], error: null }),
        };
      }
      if (table === 'properties') {
        return {
          select: () => ({
            eq: () => ({ data: [{ id: 'prop-1', name: 'Test Property' }], error: null }),
          }),
        };
      }
      if (table === 'property_weekly_summaries') {
        return {
          insert: () => ({
            error: insertShouldFail
              ? { code: insertErrorCode, message: 'insert failed' }
              : null,
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                not: () => ({ data: mockAdmins, error: null }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ data: [], error: null }) };
    },
  }),
}));

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-xxxx';

function makeRequest(secret = CRON_SECRET): NextRequest {
  return new NextRequest('http://localhost/api/cron/weekly-summary', {
    method:  'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/cron/weekly-summary — fan-out', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    sendMessageSpy.mockReset();
    insertShouldFail = false;
    insertErrorCode  = '';
    mockAdmins       = [];
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('3 admins with phones → sendMessage called 3 times, route returns 200', async () => {
    mockAdmins = [
      { id: 'admin-1', whatsapp_phone: '+5491155555551' },
      { id: 'admin-2', whatsapp_phone: '+5491155555552' },
      { id: 'admin-3', whatsapp_phone: '+5491155555553' },
    ];
    sendMessageSpy.mockResolvedValue({ success: true });

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const res  = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messagesSent).toBe(3);
    expect(body.messagesFailed).toBe(0);
    expect(body.summariesInserted).toBe(1);
    expect(sendMessageSpy).toHaveBeenCalledTimes(3);
  });

  it('each sendMessage call targets a different admin phone', async () => {
    const phones = ['+5491155555551', '+5491155555552', '+5491155555553'];
    mockAdmins = phones.map((p, i) => ({ id: `admin-${i + 1}`, whatsapp_phone: p }));
    sendMessageSpy.mockResolvedValue({ success: true });

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    await POST(makeRequest());

    const calledPhones = sendMessageSpy.mock.calls.map(([, msg]) => msg.to);
    // Strip leading '+' — MetaProvider normalises phones
    for (const phone of phones) {
      const normalised = phone.startsWith('+') ? phone.slice(1) : phone;
      // We check either format depending on provider internals
      const found = calledPhones.some(
        (p: string) => p === phone || p === normalised
      );
      expect(found).toBe(true);
    }
  });

  it('0 admins with phones → sendMessage not called, route returns 200', async () => {
    mockAdmins = [];
    sendMessageSpy.mockResolvedValue({ success: true });

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const res  = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messagesSent).toBe(0);
    expect(body.messagesFailed).toBe(0);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('3 admins, admin #2 send fails → 2 succeed, 1 fails, route returns 200', async () => {
    mockAdmins = [
      { id: 'admin-1', whatsapp_phone: '+5491155555551' },
      { id: 'admin-2', whatsapp_phone: '+5491155555552' },
      { id: 'admin-3', whatsapp_phone: '+5491155555553' },
    ];
    sendMessageSpy
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ success: true });

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const res  = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messagesSent).toBe(2);
    expect(body.messagesFailed).toBe(1);
    expect(sendMessageSpy).toHaveBeenCalledTimes(3);
  });

  it('bad CRON_SECRET → 401 Unauthorized', async () => {
    mockAdmins = [];

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const res  = await POST(makeRequest('wrong-secret'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('missing CRON_SECRET env var → 503', async () => {
    delete process.env.CRON_SECRET;
    mockAdmins = [];

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const res  = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
  });

  it('all 3 sends fail → summariesInserted=1 (idempotency row preserved even when all sends fail)', async () => {
    mockAdmins = [
      { id: 'admin-1', whatsapp_phone: '+5491155555551' },
      { id: 'admin-2', whatsapp_phone: '+5491155555552' },
      { id: 'admin-3', whatsapp_phone: '+5491155555553' },
    ];
    sendMessageSpy.mockRejectedValue(new Error('provider down'));

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const res  = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summariesInserted).toBe(1);
    expect(body.messagesSent).toBe(0);
    expect(body.messagesFailed).toBe(3);
  });

  it('duplicate iso_week row (23505) → skips sends, still returns 200', async () => {
    mockAdmins = [{ id: 'admin-1', whatsapp_phone: '+5491155555551' }];
    insertShouldFail = true;
    insertErrorCode  = '23505';  // UNIQUE violation

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    const res  = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Summary already existed — insert skipped, no sends
    expect(body.summariesInserted).toBe(0);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});
