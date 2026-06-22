import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist all mocks before module resolution ──────────────────────────────────

const { mockGetSignedUrl, mockRunOcr, mockFetch, mockDbInsert, mockDbSelect, mockDbUpdate } = vi.hoisted(() => {
  const mockGetSignedUrl = vi.fn();
  const mockRunOcr       = vi.fn();
  const mockFetch        = vi.fn();
  const mockDbInsert     = vi.fn();
  const mockDbSelect     = vi.fn();
  const mockDbUpdate     = vi.fn();
  return { mockGetSignedUrl, mockRunOcr, mockFetch, mockDbInsert, mockDbSelect, mockDbUpdate };
});

// ── Mock @/lib/storage ────────────────────────────────────────────────────────
vi.mock('@/lib/storage', () => ({
  getSignedUrl:  mockGetSignedUrl,
  uploadFile:    vi.fn(),
  deleteImage:   vi.fn(),
}));

// ── Mock @/lib/ocr/run-ocr ────────────────────────────────────────────────────
vi.mock('@/lib/ocr/run-ocr', () => ({
  runOcr: mockRunOcr,
}));

// ── Mock @/lib/whatsapp/dedupe ────────────────────────────────────────────────
vi.mock('@/lib/whatsapp/dedupe', () => ({
  sha256Hex: vi.fn().mockReturnValue('abc123sha256'),
}));

// ── Mock @/lib/db — Drizzle ───────────────────────────────────────────────────

// Per-table select results
const selectResults: Record<string, unknown[]> = {};

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return 'unknown';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find((s) => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : 'unknown';
  }

  return {
    db: {
      select: vi.fn(() => {
        let tableName = 'unknown';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            tableName = getTableName(tableRef);
            return chain;
          }),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => selectResults[tableName] ?? []),
        };
        return chain;
      }),

      insert: (tableRef: unknown) => {
        const tableName = getTableName(tableRef);
        return {
          values: vi.fn((vals: unknown) => {
            mockDbInsert(tableName, vals);
            const chain = {
              returning: vi.fn(async () => {
                if (tableName === 'payment_receipts') return [{ id: 'receipt-1' }];
                if (tableName === 'payments') return [{ id: 'payment-1' }];
                return [];
              }),
              then: (resolve: (v: unknown[]) => void, reject?: (e: Error) => void) => {
                const errCode = selectResults[`${tableName}_insert_error`]?.[0] as string | undefined;
                if (errCode) {
                  const err = Object.assign(new Error('DB insert error'), { code: errCode });
                  if (reject) return reject(err);
                  throw err;
                }
                return resolve([]);
              },
            };
            return chain;
          }),
        };
      },

      update: (tableRef: unknown) => {
        const tableName = getTableName(tableRef);
        return {
          set: vi.fn((vals: unknown) => {
            mockDbUpdate(tableName, vals);
            return {
              where: vi.fn(async () => []),
            };
          }),
        };
      },
    },
  };
});

vi.stubGlobal('fetch', mockFetch);

import { handleWhatsAppReceipt } from '@/lib/events/handlers/whatsapp-receipt';
import type { WhatsAppAttachmentReceivedPayload } from '@/lib/events/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PAYLOAD: WhatsAppAttachmentReceivedPayload = {
  orgId:          'org-1',
  tenantId:       'tenant-1',
  messageId:      'msg-1',
  conversationId: 'conv-1',
  attachmentKind: 'image',
  attachmentPath: 'orgs/org-1/receipts/img.jpg',
  classification: 'receipt',
};

function makeFetchOkResponse() {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    ok:          true,
    status:      200,
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    headers:     { get: vi.fn().mockReturnValue('image/jpeg') },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset select results
  for (const k of Object.keys(selectResults)) delete selectResults[k];

  // Default: storage returns a URL
  mockGetSignedUrl.mockResolvedValue('https://storage.example.com/img.jpg');

  // Default: fetch returns a valid image response
  mockFetch.mockResolvedValue(makeFetchOkResponse());

  // Default: OCR fails
  mockRunOcr.mockResolvedValue({ success: false, error: 'OCR failed' });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleWhatsAppReceipt', () => {
  // ── Guard clauses ──────────────────────────────────────────────────────────

  it('returns early when classification is not receipt', async () => {
    await handleWhatsAppReceipt({ ...BASE_PAYLOAD, classification: 'other' });
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('returns early when tenantId is missing', async () => {
    await handleWhatsAppReceipt({ ...BASE_PAYLOAD, tenantId: null });
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  // ── Signed URL failure ─────────────────────────────────────────────────────

  it('returns early when signed URL cannot be obtained', async () => {
    mockGetSignedUrl.mockRejectedValue(new Error('Storage error'));

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(mockRunOcr).not.toHaveBeenCalled();
  });

  // ── Image fetch failure ────────────────────────────────────────────────────

  it('returns early when image fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(mockRunOcr).not.toHaveBeenCalled();
  });

  it('returns early when image fetch returns non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(mockRunOcr).not.toHaveBeenCalled();
  });

  // ── OCR fail path → pending_review ────────────────────────────────────────

  it('inserts as pending_review when OCR fails', async () => {
    mockRunOcr.mockResolvedValue({ success: false, error: 'OCR failed' });

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    expect(mockDbInsert).toHaveBeenCalledWith(
      'payment_receipts',
      expect.objectContaining({ status: 'pending_review', orgId: 'org-1', tenantId: 'tenant-1' })
    );
  });

  it('handles 23505 duplicate on OCR-fail path — skips silently', async () => {
    mockRunOcr.mockResolvedValue({ success: false, error: 'OCR failed' });
    // Make insert throw 23505
    selectResults['payment_receipts_insert_error'] = ['23505'];

    await expect(handleWhatsAppReceipt(BASE_PAYLOAD)).resolves.toBeUndefined();
    expect(mockDbInsert).toHaveBeenCalledOnce();
  });

  // ── Auto-approve path ──────────────────────────────────────────────────────

  it('inserts as auto_approved when confidence >= 0.92, delta <= 1%, charge found', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1000, date: '2026-05-15', vendor: 'Banco', confidence: 0.94 },
    });

    // Charges returns a matching charge (amount=1000 matches OCR amount=1000)
    selectResults['charges']   = [{ id: 'charge-1', amount: '1000', contractId: 'contract-1' }];
    selectResults['contracts'] = [{ id: 'contract-1' }];

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    // payment_receipts should have been inserted with auto_approved
    const autoApproveInsert = mockDbInsert.mock.calls.find(
      c => c[0] === 'payment_receipts' && (c[1] as Record<string, unknown>)?.status === 'auto_approved'
    );
    expect(autoApproveInsert).toBeDefined();
  });

  it('does NOT auto-approve when confidence is below threshold (0.91)', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1000, date: '2026-05-15', vendor: 'Banco', confidence: 0.91 },
    });

    selectResults['charges']  = [{ id: 'charge-1', amount: '1000', contractId: 'contract-1' }];
    selectResults['tenants']  = [];  // notifyAdmin: no tenant → early return
    selectResults['profiles'] = [];

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    // Should insert as pending_review, not auto_approved
    const pendingInsert = mockDbInsert.mock.calls.find(
      c => c[0] === 'payment_receipts' && (c[1] as Record<string, unknown>)?.status === 'pending_review'
    );
    expect(pendingInsert).toBeDefined();
    const autoInsert = mockDbInsert.mock.calls.find(
      c => c[0] === 'payment_receipts' && (c[1] as Record<string, unknown>)?.status === 'auto_approved'
    );
    expect(autoInsert).toBeUndefined();
  });

  it('does NOT auto-approve when delta is > 1% even with high confidence', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1050, date: '2026-05-15', vendor: 'Banco', confidence: 0.97 },
    });

    // charge amount=1000, OCR says 1050 → delta=5% > 1%
    selectResults['charges']  = [{ id: 'charge-1', amount: '1000', contractId: 'contract-1' }];
    selectResults['tenants']  = [];
    selectResults['profiles'] = [];

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    const pendingInsert = mockDbInsert.mock.calls.find(
      c => c[0] === 'payment_receipts' && (c[1] as Record<string, unknown>)?.status === 'pending_review'
    );
    expect(pendingInsert).toBeDefined();
  });

  it('does NOT auto-approve when no matching charge found', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 500, date: '2026-05-15', vendor: 'Banco', confidence: 0.95 },
    });

    selectResults['charges']  = [];  // no charges
    selectResults['tenants']  = [];
    selectResults['profiles'] = [];

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    const pendingInsert = mockDbInsert.mock.calls.find(
      c => c[0] === 'payment_receipts' && (c[1] as Record<string, unknown>)?.status === 'pending_review'
    );
    expect(pendingInsert).toBeDefined();
  });

  it('routes to pending_review when no active contract exists despite passing auto-approve gate', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1000, date: '2026-05-15', vendor: 'Banco', confidence: 0.94 },
    });

    // charge has no contractId → will need to look up contracts
    selectResults['charges']   = [{ id: 'charge-1', amount: '1000', contractId: null }];
    selectResults['contracts'] = [];  // no active contract
    selectResults['tenants']   = [];
    selectResults['profiles']  = [];

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    const pendingInsert = mockDbInsert.mock.calls.find(
      c => c[0] === 'payment_receipts' && (c[1] as Record<string, unknown>)?.status === 'pending_review'
    );
    expect(pendingInsert).toBeDefined();
  });
});
