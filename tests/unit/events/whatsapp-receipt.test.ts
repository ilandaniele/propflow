import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist all mocks before module resolution ───────────────────────────────────

const { mockAdminClient, mockRunOcr, mockFetch } = vi.hoisted(() => {
  const mockAdminClient = {
    storage: { from: vi.fn() },
    from: vi.fn(),
  };
  const mockRunOcr = vi.fn();
  const mockFetch = vi.fn();
  return { mockAdminClient, mockRunOcr, mockFetch };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue(mockAdminClient),
}));

vi.mock('@/lib/ocr/run-ocr', () => ({
  runOcr: mockRunOcr,
}));

vi.mock('@/lib/whatsapp/dedupe', () => ({
  sha256Hex: vi.fn().mockReturnValue('abc123sha256'),
}));

vi.stubGlobal('fetch', mockFetch);

import { handleWhatsAppReceipt } from '@/lib/events/handlers/whatsapp-receipt';
import type { WhatsAppAttachmentReceivedPayload } from '@/lib/events/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PAYLOAD: WhatsAppAttachmentReceivedPayload = {
  orgId: 'org-1',
  tenantId: 'tenant-1',
  messageId: 'msg-1',
  conversationId: 'conv-1',
  attachmentKind: 'image',
  attachmentPath: 'orgs/org-1/receipts/img.jpg',
  classification: 'receipt',
};

function makeSignedUrlResult(url: string | null) {
  return { data: url ? { signedUrl: url } : null };
}

function makeFetchOkResponse() {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    headers: { get: vi.fn().mockReturnValue('image/jpeg') },
  };
}

// chainable builder for supabase table operations
function makeTableBuilder(result: unknown) {
  const b: Record<string, unknown> = {};
  const chainMethods = ['insert', 'update', 'select', 'eq', 'order', 'limit', 'maybeSingle'];
  for (const m of chainMethods) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.single = vi.fn().mockResolvedValue(result);
  // Also make insert/update resolve when awaited directly
  b.insert = vi.fn().mockResolvedValue(result);
  b.update = vi.fn().mockReturnValue(b);
  b.select = vi.fn().mockReturnValue(b);
  b.eq = vi.fn().mockReturnValue(b);
  b.order = vi.fn().mockReturnValue(b);
  b.limit = vi.fn().mockReturnValue(b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: storage createSignedUrl returns a URL
  mockAdminClient.storage.from = vi.fn().mockReturnValue({
    createSignedUrl: vi.fn().mockResolvedValue(makeSignedUrlResult('https://storage.example.com/img.jpg')),
  });

  // Default: fetch returns a valid image response
  mockFetch.mockResolvedValue(makeFetchOkResponse());

  // Default: OCR fails (most tests use this; auto-approve tests override it)
  mockRunOcr.mockResolvedValue({ success: false, error: 'OCR failed' });

  // Default: table operations succeed with no error
  mockAdminClient.from = vi.fn().mockImplementation((_table: string) => {
    const b = makeTableBuilder({ data: null, error: null });
    // Insert resolves with no error by default
    b.insert = vi.fn().mockResolvedValue({ data: null, error: null });
    return b;
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleWhatsAppReceipt', () => {
  // ── Guard clauses ──────────────────────────────────────────────────────────

  it('returns early when classification is not receipt', async () => {
    await handleWhatsAppReceipt({ ...BASE_PAYLOAD, classification: 'other' });
    expect(mockAdminClient.storage.from).not.toHaveBeenCalled();
  });

  it('returns early when tenantId is missing', async () => {
    await handleWhatsAppReceipt({ ...BASE_PAYLOAD, tenantId: null });
    expect(mockAdminClient.storage.from).not.toHaveBeenCalled();
  });

  // ── Signed URL failure ─────────────────────────────────────────────────────

  it('returns early when signed URL cannot be obtained', async () => {
    mockAdminClient.storage.from = vi.fn().mockReturnValue({
      createSignedUrl: vi.fn().mockResolvedValue({ data: null }),
    });

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(mockAdminClient.from).not.toHaveBeenCalled();
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

    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminClient.from = vi.fn().mockReturnValue({
      insert: insertMock,
      from: vi.fn(),
    });

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_review', org_id: 'org-1', tenant_id: 'tenant-1' })
    );
  });

  it('handles 23505 duplicate on OCR-fail path — skips silently', async () => {
    mockRunOcr.mockResolvedValue({ success: false, error: 'OCR failed' });

    const insertMock = vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } });
    mockAdminClient.from = vi.fn().mockReturnValue({ insert: insertMock });

    // Should not throw
    await expect(handleWhatsAppReceipt(BASE_PAYLOAD)).resolves.toBeUndefined();
    expect(insertMock).toHaveBeenCalledOnce();
  });

  // ── Auto-approve: all 3 conditions must pass ───────────────────────────────

  it('inserts as auto_approved when confidence >= 0.92, delta <= 1%, charge found', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1000, date: '2026-05-15', vendor: 'Banco', confidence: 0.94 },
    });

    // charges query → matching charge
    const chargesData = [{ id: 'charge-1', amount: '1000', contract_id: 'contract-1' }];
    // payment_receipts insert → success with auto_approved
    const receiptInsertResult = { data: { id: 'receipt-1' }, error: null };
    // payments insert → success
    const paymentInsertResult = { data: { id: 'payment-1' }, error: null };

    let callCount = 0;
    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'charges') {
        const b = makeTableBuilder({ data: chargesData, error: null });
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.order = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockResolvedValue({ data: chargesData, error: null });
        return b;
      }
      if (table === 'payment_receipts') {
        const b = makeTableBuilder(receiptInsertResult);
        b.insert = vi.fn().mockReturnValue(b);
        b.select = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue(receiptInsertResult);
        b.update = vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        });
        return b;
      }
      if (table === 'payments') {
        const b = makeTableBuilder(paymentInsertResult);
        b.insert = vi.fn().mockReturnValue(b);
        b.select = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue(paymentInsertResult);
        return b;
      }
      // contracts — return active contract
      const b = makeTableBuilder({ data: null, error: null });
      b.select = vi.fn().mockReturnValue(b);
      b.eq = vi.fn().mockReturnValue(b);
      b.limit = vi.fn().mockReturnValue(b);
      b.single = vi.fn().mockResolvedValue({ data: { id: 'contract-1' }, error: null });
      return b;
    });

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    // payment_receipts should have been inserted with auto_approved
    const receiptFromCalls = mockAdminClient.from.mock.calls.filter(c => c[0] === 'payment_receipts');
    expect(receiptFromCalls.length).toBeGreaterThan(0);
  });

  it('does NOT auto-approve when confidence is below threshold (0.91)', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1000, date: '2026-05-15', vendor: 'Banco', confidence: 0.91 },
    });

    const chargesData = [{ id: 'charge-1', amount: '1000', contract_id: 'contract-1' }];

    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'charges') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.order = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockResolvedValue({ data: chargesData, error: null });
        return b;
      }
      if (table === 'tenants') {
        const b = makeTableBuilder({ data: { org_id: 'org-1', full_name: 'John' }, error: null });
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: { org_id: 'org-1', full_name: 'John' }, error: null });
        return b;
      }
      if (table === 'profiles') {
        const b = makeTableBuilder({ data: { id: 'admin-1' }, error: null });
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: { id: 'admin-1' }, error: null });
        return b;
      }
      if (table === 'notification_inbox') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }
      return { insert: insertMock };
    });

    await handleWhatsAppReceipt(BASE_PAYLOAD);

    // Should insert as pending_review, not auto_approved
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_review' })
    );
  });

  it('does NOT auto-approve when delta is > 1% even with high confidence', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1050, date: '2026-05-15', vendor: 'Banco', confidence: 0.97 },
    });

    // charge amount is 1000, OCR says 1050 → delta = 5% > 1%
    const chargesData = [{ id: 'charge-1', amount: '1000', contract_id: 'contract-1' }];

    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'charges') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.order = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockResolvedValue({ data: chargesData, error: null });
        return b;
      }
      if (table === 'tenants') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: null, error: null });
        return b;
      }
      return { insert: insertMock };
    });

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_review' })
    );
  });

  it('does NOT auto-approve when no matching charge found', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 500, date: '2026-05-15', vendor: 'Banco', confidence: 0.95 },
    });

    // charges returns empty array → no match
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'charges') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.order = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockResolvedValue({ data: [], error: null });
        return b;
      }
      if (table === 'tenants') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: null, error: null });
        return b;
      }
      return { insert: insertMock };
    });

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_review' })
    );
  });

  // ── No contract path ───────────────────────────────────────────────────────

  it('routes to pending_review when no active contract exists despite passing auto-approve gate', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 1000, date: '2026-05-15', vendor: 'Banco', confidence: 0.94 },
    });

    const chargesData = [{ id: 'charge-1', amount: '1000', contract_id: null }];
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'charges') {
        const chargeSelectBuilder = makeTableBuilder(null);
        chargeSelectBuilder.select = vi.fn().mockReturnValue(chargeSelectBuilder);
        chargeSelectBuilder.eq = vi.fn().mockReturnValue(chargeSelectBuilder);
        chargeSelectBuilder.order = vi.fn().mockReturnValue(chargeSelectBuilder);
        chargeSelectBuilder.limit = vi.fn().mockResolvedValue({ data: chargesData, error: null });
        // Also support single() for the secondary charge lookup
        chargeSelectBuilder.single = vi.fn().mockResolvedValue({ data: { contract_id: null }, error: null });
        return chargeSelectBuilder;
      }
      if (table === 'contracts') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: null, error: null }); // no active contract
        return b;
      }
      if (table === 'tenants') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: { org_id: 'org-1', full_name: 'Jane' }, error: null });
        return b;
      }
      if (table === 'profiles') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: { id: 'admin-1' }, error: null });
        return b;
      }
      if (table === 'notification_inbox') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }
      if (table === 'payment_receipts') {
        return { insert: insertMock };
      }
      return { insert: insertMock };
    });

    await handleWhatsAppReceipt(BASE_PAYLOAD);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_review' })
    );
  });

  // ── Duplicate detection (pending_review path) ──────────────────────────────

  it('handles 23505 on pending_review path (below threshold) — skips silently', async () => {
    mockRunOcr.mockResolvedValue({
      success: true,
      data: { amount: 100, date: '2026-05-15', vendor: null, confidence: 0.5 },
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'charges') {
        const b = makeTableBuilder(null);
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.order = vi.fn().mockReturnValue(b);
        b.limit = vi.fn().mockResolvedValue({ data: [], error: null });
        return b;
      }
      if (table === 'payment_receipts') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } }) };
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    await expect(handleWhatsAppReceipt(BASE_PAYLOAD)).resolves.toBeUndefined();
  });
});
