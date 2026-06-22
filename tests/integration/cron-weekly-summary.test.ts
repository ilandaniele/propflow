/**
 * Integration tests for POST /api/cron/weekly-summary (fan-out refactor).
 *
 * Mocks:
 * - @/lib/db — returns configurable Drizzle stubs
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

// Configurable per-test admin profiles (camelCase — Drizzle returns camelCase)
let mockAdmins: Array<{ id: string; whatsappPhone: string | null }> = [];
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

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return '';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : '';
  }

  return {
    db: {
      select: vi.fn(() => {
        let tableName = '';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            tableName = getTableName(tableRef);
            return chain;
          }),
          where: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown[]) => void) => {
            // Promise.all pattern — called without .limit()
            if (tableName === 'organizations') resolve([{ id: 'org-1', name: 'Test Org' }]);
            else if (tableName === 'properties') resolve([{ id: 'prop-1', name: 'Test Property' }]);
            else if (tableName === 'profiles') resolve(mockAdmins);
            else resolve([]);
          },
          // Some queries use await on the chain directly
          [Symbol.toStringTag]: 'Promise',
        };
        // Make chain itself awaitable via .then
        (chain as unknown as Promise<unknown[]>).then = chain.then as never;
        return chain;
      }),

      insert: vi.fn(() => ({
        values: vi.fn(async () => {
          if (insertShouldFail) {
            const err = new Error('insert failed') as Error & { code: string };
            err.code = insertErrorCode;
            throw err;
          }
          return [];
        }),
      })),

      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    },
  };
});

vi.mock('@/lib/log', () => ({
  log: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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
      { id: 'admin-1', whatsappPhone: '+5491155555551' },
      { id: 'admin-2', whatsappPhone: '+5491155555552' },
      { id: 'admin-3', whatsappPhone: '+5491155555553' },
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
    mockAdmins = phones.map((p, i) => ({ id: `admin-${i + 1}`, whatsappPhone: p }));
    sendMessageSpy.mockResolvedValue({ success: true });

    const { POST } = await import('@/app/api/cron/weekly-summary/route');
    await POST(makeRequest());

    const calledPhones = sendMessageSpy.mock.calls.map(([, msg]) => (msg as { to: string }).to);
    for (const phone of phones) {
      const normalised = phone.startsWith('+') ? phone.slice(1) : phone;
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
      { id: 'admin-1', whatsappPhone: '+5491155555551' },
      { id: 'admin-2', whatsappPhone: '+5491155555552' },
      { id: 'admin-3', whatsappPhone: '+5491155555553' },
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
      { id: 'admin-1', whatsappPhone: '+5491155555551' },
      { id: 'admin-2', whatsappPhone: '+5491155555552' },
      { id: 'admin-3', whatsappPhone: '+5491155555553' },
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
    mockAdmins = [{ id: 'admin-1', whatsappPhone: '+5491155555551' }];
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
