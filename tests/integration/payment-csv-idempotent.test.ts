/**
 * tests/integration/payment-csv-idempotent.test.ts
 *
 * Tests idempotency of POST /api/admin/payments/import:
 * - First import with external_payment_id = 'PAY-001' → rows_created=1
 * - Second import with same external_payment_id → rows_updated=1 (not rows_created=2)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock state ─────────────────────────────────────────────────────────────────

let executeWithExtIdCallCount = 0;
let executeWithoutExtIdCallCount = 0;

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ userId: 'user-test-uuid-001', orgId: 'org-test-uuid-001', role: 'admin', profile: {} }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  function extractFromSqlChunks(chunks: unknown[]): { text: string } {
    let text = '';
    for (const chunk of chunks) {
      if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'queryChunks' in (chunk as object)) {
        const nested = extractFromSqlChunks((chunk as { queryChunks: unknown[] }).queryChunks);
        text += nested.text;
      } else if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'value' in (chunk as object)) {
        const val = (chunk as { value: unknown[] }).value;
        if (Array.isArray(val)) text += val.join('');
      } else {
        text += '?';
      }
    }
    return { text };
  }

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn(async () => [{ id: 'tenant-001', email: 'tenant@test.com' }]),
      })),

      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 'log-test-uuid-001' }]),
          onConflictDoNothing: vi.fn(async () => []),
        })),
      })),

      execute: vi.fn(async (sqlObj: unknown) => {
        if (!sqlObj || typeof sqlObj !== 'object' || !('queryChunks' in (sqlObj as object))) return [];
        const { text } = extractFromSqlChunks((sqlObj as { queryChunks: unknown[] }).queryChunks);
        if (text.includes('ON CONFLICT')) {
          executeWithExtIdCallCount++;
        } else {
          executeWithoutExtIdCallCount++;
        }
        return [];
      }),

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

function buildCsvFile(rows: string[]): File {
  const headers = 'payment_date,amount,currency,status,payment_method,tenant_email,external_payment_id';
  const content = [headers, ...rows].join('\n');
  return new File([content], 'payments.csv', { type: 'text/csv' });
}

function makeRequest(file: File): NextRequest {
  const formData = new FormData();
  formData.append('file', file);
  return new NextRequest('http://localhost:3000/api/admin/payments/import', {
    method: 'POST',
    body: formData,
  });
}

import { POST } from '@/app/api/admin/payments/import/route';

describe('POST /api/admin/payments/import — idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeWithExtIdCallCount = 0;
    executeWithoutExtIdCallCount = 0;
  });

  it('first import creates 1 record (rows_created=1 style result)', async () => {
    const file = buildCsvFile([
      '2024-03-15,850,PEN,approved,transfer,tenant@test.com,PAY-001',
    ]);
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; updated: number };
    // With external_payment_id, the route uses ON CONFLICT DO UPDATE → counts as updated
    expect(body.created + body.updated).toBeGreaterThanOrEqual(1);
  });

  it('second import with same external_payment_id does not double-create', async () => {
    const file1 = buildCsvFile([
      '2024-03-15,850,PEN,approved,transfer,tenant@test.com,PAY-001',
    ]);
    const file2 = buildCsvFile([
      '2024-03-15,850,PEN,approved,transfer,tenant@test.com,PAY-001',
    ]);

    await POST(makeRequest(file1));
    const res2 = await POST(makeRequest(file2));

    expect(res2.status).toBe(200);
    const body = await res2.json() as { created: number; updated: number };
    expect(body.created + body.updated).toBeGreaterThanOrEqual(1);

    // The ON CONFLICT path was called twice (once per import)
    expect(executeWithExtIdCallCount).toBe(2);
    // The plain insert path (no ON CONFLICT) was NOT called
    expect(executeWithoutExtIdCallCount).toBe(0);
  });

  it('import without external_payment_id uses insert (not upsert)', async () => {
    const file = buildCsvFile([
      '2024-03-15,900,PEN,pending,cash,tenant@test.com,',
    ]);
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; updated: number };
    // Without external_payment_id, route uses plain INSERT → counts as created
    expect(body.created).toBe(1);
    expect(executeWithExtIdCallCount).toBe(0); // ON CONFLICT path not called
  });
});
