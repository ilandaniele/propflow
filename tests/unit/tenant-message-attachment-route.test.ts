import { describe, it, expect, vi, beforeEach } from 'vitest';

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({
  ctx: null as null | { userId: string; orgId: string; role: 'admin' | 'tenant' },
  rateLimited: false,
  attachment: null as null | { key: string; name: string; mime: string },
}));

const findMessageAttachment = vi.hoisted(() => vi.fn(async () => state.attachment));
const getSignedUrl = vi.hoisted(() => vi.fn(async () => 'https://acct.r2.cloudflarestorage.com/propflow-files/key?sig=1'));

vi.mock('@/lib/auth/guards', () => ({
  requireUser: vi.fn(async () => {
    if (!state.ctx) throw new Error('UNAUTHORIZED');
    return state.ctx;
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ actionRateLimit: vi.fn(() => ({ success: !state.rateLimited, retryAfterMs: 0 })) }));
vi.mock('@/lib/messages/queries', () => ({ findMessageAttachment }));
vi.mock('@/lib/storage/index', () => ({ getSignedUrl }));
vi.mock('@/lib/log', () => ({ log: { error: vi.fn() } }));

import { GET } from '@/app/api/tenant-messages/[id]/attachment/route';

function call(id: string) {
  return GET(new Request(`http://localhost/api/tenant-messages/${id}/attachment`) as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  state.ctx = { userId: USER_ID, orgId: ORG_ID, role: 'admin' };
  state.rateLimited = false;
  state.attachment = { key: `${ORG_ID}/tenant-messages/abc.pdf`, name: 'lease.pdf', mime: 'application/pdf' };
  findMessageAttachment.mockClear();
  getSignedUrl.mockClear();
});

describe('GET /api/tenant-messages/[id]/attachment', () => {
  it('returns 401 without a session', async () => {
    state.ctx = null;
    expect((await call(MESSAGE_ID)).status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    state.rateLimited = true;
    expect((await call(MESSAGE_ID)).status).toBe(429);
  });

  it('returns 404 for a malformed id without querying', async () => {
    expect((await call('not-a-uuid')).status).toBe(404);
    expect(findMessageAttachment).not.toHaveBeenCalled();
  });

  it('scopes admins to their org and redirects to a short-lived signed URL', async () => {
    const res = await call(MESSAGE_ID);
    expect(findMessageAttachment).toHaveBeenCalledWith({ messageId: MESSAGE_ID, orgId: ORG_ID, senderId: undefined });
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(getSignedUrl).toHaveBeenCalledWith('tenant-messages', `${ORG_ID}/tenant-messages/abc.pdf`, expect.any(Number));
  });

  it('scopes tenants to their own messages', async () => {
    state.ctx = { userId: USER_ID, orgId: ORG_ID, role: 'tenant' };
    await call(MESSAGE_ID);
    expect(findMessageAttachment).toHaveBeenCalledWith({ messageId: MESSAGE_ID, orgId: ORG_ID, senderId: USER_ID });
  });

  it('returns 404 when the message is not visible or has no attachment', async () => {
    state.attachment = null;
    expect((await call(MESSAGE_ID)).status).toBe(404);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns 404 when the stored key is outside the caller org', async () => {
    state.attachment = { key: 'other-org/tenant-messages/abc.pdf', name: 'x.pdf', mime: 'application/pdf' };
    expect((await call(MESSAGE_ID)).status).toBe(404);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
