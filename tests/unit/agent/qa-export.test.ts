import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── db: a queue-based chainable mock. Each top-level db.<verb>() call pops
// the next queued result and returns a thenable chain that resolves to it
// regardless of which chain method the caller awaits from. ─────────────────
const { dbQueue, resetDbQueue } = vi.hoisted(() => {
  const dbQueue: unknown[] = [];
  return { dbQueue, resetDbQueue: () => { dbQueue.length = 0; } };
});

function makeChain() {
  const result = dbQueue.length > 0 ? dbQueue.shift() : [];
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = self;
  chain.innerJoin = self;
  chain.leftJoin = self;
  chain.where = self;
  chain.orderBy = self;
  chain.limit = self;
  chain.values = self;
  chain.set = self;
  chain.onConflictDoNothing = self;
  chain.returning = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => makeChain()),
    selectDistinct: vi.fn(() => makeChain()),
    insert: vi.fn(() => makeChain()),
    update: vi.fn(() => makeChain()),
  },
}));

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/notifications/email', () => ({ sendEmail: sendEmailMock }));

const { getConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(async () => ({ timezone: 'America/Lima' })),
}));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig: getConfigMock }));

const { requireAdminMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(async () => ({ userId: 'user-1', orgId: 'org-1', role: 'admin', profile: {} })),
}));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: requireAdminMock }));

vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })) }));

import { previousWeekRange, toCsv, buildQaEmail, generateWeeklyQaExport, type QaRow } from '@/lib/agent/qa-export';
import { GET as downloadQaExport } from '@/app/api/agent/qa-export/route';
import { NextRequest } from 'next/server';

function row(overrides: Partial<QaRow> = {}): QaRow {
  return {
    occurredAt: new Date('2026-09-08T10:05:00Z'),
    kind: 'handoff',
    reason: 'complaint',
    isComplaint: true,
    summary: null,
    sessionId: 's1',
    channel: 'whatsapp',
    leadId: 'l1',
    leadName: 'Ana',
    leadPhone: '+51987654321',
    leadStage: 'new',
    advisorName: 'Carlos',
    agentTurns: 4,
    firstHumanReplyMinutes: 12,
    ...overrides,
  };
}

beforeEach(() => {
  resetDbQueue();
  sendEmailMock.mockClear();
  getConfigMock.mockClear();
  requireAdminMock.mockClear();
});

describe('previousWeekRange', () => {
  it('returns the same previous week for any weekday within the current local week', () => {
    // Sun 2026-09-20 23:30 America/Lima == 2026-09-21T04:30:00Z
    const beforeMonday = previousWeekRange(new Date('2026-09-21T04:30:00.000Z'), 'America/Lima');
    expect(beforeMonday.weekStart).toBe('2026-09-07');
  });

  it('crosses to a new previous week right after the local Monday boundary', () => {
    // Mon 2026-09-21 00:30 America/Lima == 2026-09-21T05:30:00Z — one hour later, but a new local week.
    const afterMonday = previousWeekRange(new Date('2026-09-21T05:30:00.000Z'), 'America/Lima');
    expect(afterMonday.weekStart).toBe('2026-09-14');
    expect(afterMonday.periodStart.toISOString()).toBe('2026-09-14T05:00:00.000Z');
    expect(afterMonday.periodEnd.toISOString()).toBe('2026-09-21T05:00:00.000Z');
  });
});

describe('toCsv', () => {
  it('has a UTF-8 BOM', () => {
    const csv = toCsv([row()], 'America/Lima');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('escapes embedded quotes and newlines (RFC 4180)', () => {
    const csv = toCsv([row({ summary: 'Cliente dijo "muy caro"\ny se quejó' })], 'America/Lima');
    expect(csv).toContain('"Cliente dijo ""muy caro""\ny se quejó"');
  });

  it('quotes a cell containing a comma', () => {
    const csv = toCsv([row({ advisorName: 'Ana, Torres' })], 'America/Lima');
    expect(csv).toContain('"Ana, Torres"');
  });

  it('guards against formula injection on =, +, -, @ prefixes', () => {
    for (const malicious of ['=SUM(A1:A2)', '+1+1', '-1+1', '@SUM(A1)']) {
      const csv = toCsv([row({ leadName: malicious })], 'America/Lima');
      expect(csv).toContain(`'${malicious}`);
    }
  });

  it('does not guard an E.164 phone number even though it starts with +', () => {
    const csv = toCsv([row({ leadPhone: '+51987654321' })], 'America/Lima');
    expect(csv).toContain(',+51987654321,');
    expect(csv).not.toContain(",'+51987654321,");
  });

  it('still guards a non-E.164 value starting with + (not all-digits)', () => {
    const csv = toCsv([row({ leadName: '+1abc' })], 'America/Lima');
    expect(csv).toContain("'+1abc");
  });
});

describe('buildQaEmail', () => {
  it('escapes lead names and masks phone numbers', () => {
    const { html } = buildQaEmail({
      orgName: 'Acme Realty',
      weekStart: '2026-09-07',
      timeZone: 'America/Lima',
      counts: { handoffs: 3, complaints: 1, takeovers: 2 },
      top: [row({ leadName: '<script>alert(1)</script>', leadPhone: '+51987654321' })],
      dashboardUrl: 'https://example.com/dashboard/agent/qa',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('+51•••••321');
    expect(html).not.toContain('987654321');
  });

  it('formats event dates using the passed timeZone, not a hardcoded one', () => {
    // 2026-09-08T10:05:00Z: 2026-09-08 05:05 in America/Lima (UTC-5) vs 2026-09-08 12:05 in Europe/Madrid (UTC+2).
    const lima = buildQaEmail({
      orgName: 'Acme Realty',
      weekStart: '2026-09-07',
      timeZone: 'America/Lima',
      counts: { handoffs: 1, complaints: 0, takeovers: 0 },
      top: [row()],
      dashboardUrl: null,
    });
    const madrid = buildQaEmail({
      orgName: 'Acme Realty',
      weekStart: '2026-09-07',
      timeZone: 'Europe/Madrid',
      counts: { handoffs: 1, complaints: 0, takeovers: 0 },
      top: [row()],
      dashboardUrl: null,
    });

    expect(lima.html).toContain('2026-09-08 05:05');
    expect(madrid.html).toContain('2026-09-08 12:05');
  });

  it('omits the dashboard button when dashboardUrl is null', () => {
    const { html } = buildQaEmail({
      orgName: 'Acme Realty',
      weekStart: '2026-09-07',
      timeZone: 'America/Lima',
      counts: { handoffs: 0, complaints: 0, takeovers: 0 },
      top: [],
      dashboardUrl: null,
    });

    expect(html).not.toContain('<a href=');
    expect(html).not.toContain('Ver todos en el panel');
  });
});

describe('generateWeeklyQaExport', () => {
  it('a second run for the same org/week returns exists and never re-emails', async () => {
    dbQueue.push([{ id: 'exp-1', rowCount: 5 }]); // existing row found

    const result = await generateWeeklyQaExport('org-1', new Date('2026-09-22T00:00:00Z'));

    expect(result).toEqual({ status: 'exists', exportId: 'exp-1', rows: 5 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends no email when the week has zero qualifying rows', async () => {
    dbQueue.push([]); // no existing row
    dbQueue.push([]); // collectQaRows: no agent_events rows
    dbQueue.push([{ id: 'exp-2' }]); // insert ... returning

    const result = await generateWeeklyQaExport('org-1', new Date('2026-09-22T00:00:00Z'));

    expect(result).toEqual({ status: 'created', exportId: 'exp-2', rows: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/agent/qa-export', () => {
  it('rejects an export id belonging to another org (404)', async () => {
    dbQueue.push([]); // org-scoped lookup finds nothing for a foreign id

    const req = new NextRequest('https://app.test/api/agent/qa-export?id=11111111-1111-1111-1111-111111111111');
    const res = await downloadQaExport(req);

    expect(res.status).toBe(404);
  });

  it('rejects an ad-hoc range longer than 31 days (400)', async () => {
    const req = new NextRequest('https://app.test/api/agent/qa-export?from=2026-01-01&to=2026-03-01');
    const res = await downloadQaExport(req);

    expect(res.status).toBe(400);
  });
});
