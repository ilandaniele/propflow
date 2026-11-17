/**
 * POST /api/cron/airtable-final-copy — auth, parameter parsing, summary passthrough.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const runCopyBatch = vi.hoisted(() => vi.fn());
const runRecoverBatch = vi.hoisted(() => vi.fn());
const runVerifyTable = vi.hoisted(() => vi.fn());

vi.mock('@/lib/airtable-final/copy', () => ({ runCopyBatch }));
vi.mock('@/lib/airtable-final/recover', () => ({ runRecoverBatch }));
vi.mock('@/lib/airtable-final/verify', () => ({ runVerifyTable }));
vi.mock('@/lib/db', () => ({ db: { execute: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '@/app/api/cron/airtable-final-copy/route';

const SECRET = 'test-cron-secret';

function request(query = '', authorization?: string): NextRequest {
  return new NextRequest(`http://localhost/api/cron/airtable-final-copy${query}`, {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

describe('POST /api/cron/airtable-final-copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', SECRET);
    runCopyBatch.mockResolvedValue({ copied: 2, skipped: 1, failed: 0, remaining: 5, errors: [] });
    runRecoverBatch.mockResolvedValue({ total: 3, processed: 3, recovered: 1, nextAfter: null, groups: [], errors: [] });
    runVerifyTable.mockResolvedValue({ table: null, columnsOnAirtable: {}, nextAfter: 'eecc' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects a missing bearer token', async () => {
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(runCopyBatch).not.toHaveBeenCalled();
  });

  it('rejects a wrong bearer token', async () => {
    const res = await POST(request('?mode=apply', 'Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(runCopyBatch).not.toHaveBeenCalled();
  });

  it('returns 503 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await POST(request('', `Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });

  it('defaults to dry-run with limit 50 and returns the summary', async () => {
    const res = await POST(request('', `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(runCopyBatch).toHaveBeenCalledWith({ mode: 'dry-run', limit: 50 });
    expect(await res.json()).toEqual({ status: 'ok', mode: 'dry-run', copied: 2, skipped: 1, failed: 0, remaining: 5, errors: [] });
  });

  it('passes mode=apply and caps limit at 200', async () => {
    await POST(request('?mode=apply&limit=999', `Bearer ${SECRET}`));
    expect(runCopyBatch).toHaveBeenCalledWith({ mode: 'apply', limit: 200 });
  });

  it('routes mode=verify to the table check with the cursor', async () => {
    const res = await POST(request('?mode=verify&after=adicionales', `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(runVerifyTable).toHaveBeenCalledWith({ after: 'adicionales' });
    expect(runCopyBatch).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ status: 'ok', mode: 'verify', nextAfter: 'eecc' });
  });

  it.each(['report', 'recover'])('routes mode=%s to the recovery pass with the cursor', async (mode) => {
    const res = await POST(request(`?mode=${mode}&limit=20&after=${encodeURIComponent('pagos/rec1/Comprobante/att1')}`, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(runRecoverBatch).toHaveBeenCalledWith({ mode, limit: 20, after: 'pagos/rec1/Comprobante/att1' });
    expect(runCopyBatch).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ status: 'ok', mode, recovered: 1, nextAfter: null });
  });

  it('rejects an oversized cursor with 400', async () => {
    const res = await POST(request(`?mode=report&after=${'x'.repeat(501)}`, `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
    expect(runRecoverBatch).not.toHaveBeenCalled();
  });

  it('rejects invalid mode or limit with 400', async () => {
    expect((await POST(request('?mode=delete', `Bearer ${SECRET}`))).status).toBe(400);
    expect((await POST(request('?limit=0', `Bearer ${SECRET}`))).status).toBe(400);
    expect((await POST(request('?limit=abc', `Bearer ${SECRET}`))).status).toBe(400);
    expect(runCopyBatch).not.toHaveBeenCalled();
  });

  it('returns a generic 500 without leaking the error', async () => {
    runCopyBatch.mockRejectedValue(new Error('secret-ish detail https://x'));
    const res = await POST(request('?mode=apply', `Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-ish');
  });
});
