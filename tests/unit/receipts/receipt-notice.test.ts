import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  updateResult: [] as unknown[],
  inserts: [] as unknown[],
  scheduled: [] as Promise<unknown>[],
}));

function chain(rows: unknown[]) {
  const self: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'limit']) self[method] = () => self;
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return self;
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => chain(state.selectResults.shift() ?? [])),
    insert: vi.fn(() => ({ values: (v: unknown) => { state.inserts.push(v); return Promise.resolve(); } })),
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(state.updateResult) }) }) })),
  },
}));

vi.mock('@/lib/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/email')>()),
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/lib/receipts/payment-receipt', () => ({
  loadPaymentReceipt: vi.fn(async () => ({
    number: 'REC-ABCD1234', orgName: 'Acme', tenantName: 'Ana Pérez', propertyName: null, unitLabel: null,
    amount: '850', currency: 'PEN', paidAt: '2026-11-05', method: 'transfer', concept: null, reference: null,
  })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), paymentApproved: vi.fn() },
}));

vi.mock('next/server', () => ({ after: (run: () => Promise<unknown>) => { state.scheduled.push(run()); } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'cf-ray': 'ray-123' }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({ userId: 'admin-1', orgId: 'org-1', role: 'admin' })),
  requireUser: vi.fn(),
}));

import { sendEmail } from '@/lib/notifications/email';
import { log } from '@/lib/log';
import { sendReceiptNotice } from '@/lib/receipts/receipt-notice';
import { approvePayment } from '@/app/actions/payments';

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const recipient = { email: 'ana@example.com', profileId: 'profile-1', language: 'es' };

function approve() {
  const form = new FormData();
  form.set('payment_id', PAYMENT_ID);
  return approvePayment({}, form);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.selectResults = [];
  state.updateResult = [];
  state.inserts = [];
  state.scheduled = [];
});

describe('sendReceiptNotice', () => {
  it('emails the tenant once with a link to the receipt and adds an inbox entry', async () => {
    state.selectResults = [[recipient]];

    await sendReceiptNotice('org-1', PAYMENT_ID, 'req-1');

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(sendEmail).mock.calls[0];
    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe('Tu constancia de pago REC-ABCD1234');
    expect(message.html).toContain('http://localhost:3000/portal/payments');
    expect(message.html).toContain('PEN 850.00');
    expect(state.inserts).toEqual([expect.objectContaining({
      orgId: 'org-1', profileId: 'profile-1', type: 'payment_receipt', relatedType: 'payment', relatedId: PAYMENT_ID,
    })]);
  });

  it('uses the tenant language', async () => {
    state.selectResults = [[{ ...recipient, language: 'en' }]];
    await sendReceiptNotice('org-1', PAYMENT_ID, 'req-1');
    expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toBe('Your payment receipt REC-ABCD1234');
  });

  it('skips the email when the tenant has no email', async () => {
    state.selectResults = [[{ ...recipient, email: null }]];
    await sendReceiptNotice('org-1', PAYMENT_ID, 'req-1');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(1);
  });

  it('logs a failed send with the request id and does not throw', async () => {
    state.selectResults = [[recipient]];
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: 'validation_error' });
    await expect(sendReceiptNotice('org-1', PAYMENT_ID, 'req-9')).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('[receipt-notice] email failed', expect.objectContaining({ requestId: 'req-9', paymentId: PAYMENT_ID }));
  });

  it('swallows an exception from the email helper', async () => {
    state.selectResults = [[recipient]];
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('boom'));
    await expect(sendReceiptNotice('org-1', PAYMENT_ID, 'req-9')).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('[receipt-notice] failed', expect.objectContaining({ requestId: 'req-9', error: 'boom' }));
  });
});

describe('approvePayment receipt email', () => {
  it('sends the receipt once after approving a pending payment', async () => {
    state.selectResults = [[{ id: PAYMENT_ID, status: 'pending' }], [recipient]];
    state.updateResult = [{ id: PAYMENT_ID }];

    expect(await approve()).toEqual({ data: undefined });
    await Promise.all(state.scheduled);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe('ana@example.com');
  });

  it('still approves when the email fails', async () => {
    state.selectResults = [[{ id: PAYMENT_ID, status: 'pending' }], [recipient]];
    state.updateResult = [{ id: PAYMENT_ID }];
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('provider down'));

    expect((await approve()).error).toBeUndefined();
    await Promise.all(state.scheduled);
    expect(log.error).toHaveBeenCalledWith('[receipt-notice] failed', expect.objectContaining({ requestId: 'ray-123' }));
  });

  it('does not send again for an already approved payment', async () => {
    state.selectResults = [[{ id: PAYMENT_ID, status: 'approved' }]];
    expect((await approve()).error?.code).toBe('CONFLICT');
    expect(state.scheduled).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send when a concurrent approval already flipped the status', async () => {
    state.selectResults = [[{ id: PAYMENT_ID, status: 'pending' }]];
    state.updateResult = [];
    expect((await approve()).error?.code).toBe('CONFLICT');
    expect(state.scheduled).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
