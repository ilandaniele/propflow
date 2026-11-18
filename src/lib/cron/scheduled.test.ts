import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from '@/lib/log';
import { runScheduled } from './scheduled';

const MONDAY_15_UTC = new Date('2026-11-16T15:00:00Z');
const SWEEP_MINUTE = new Date('2026-11-16T10:05:00Z');
const env = { CRON_SECRET: 'test-cron-secret' };
const ctx = {};

type Handler = (request: Request, env: object, context: object) => Promise<Response>;
const okHandler = (body: string | null = null) => vi.fn<Handler>(async () => new Response(body, { status: 200 }));

describe('runScheduled', () => {
  beforeEach(() => {
    vi.spyOn(log, 'error').mockImplementation(() => {});
    vi.spyOn(log, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('POSTs each due job in order with the bearer secret', async () => {
    const fetchHandler = okHandler('{}');
    await runScheduled('* * * * *', SWEEP_MINUTE, env, ctx, fetchHandler);

    const requests = fetchHandler.mock.calls.map(([request]) => request);
    expect(requests.map((r) => new URL(r.url).pathname + new URL(r.url).search)).toEqual([
      '/api/cron/agent-dispatch?sweep=1',
      '/api/cron/agent-dispatch',
    ]);
    for (const r of requests) {
      expect(r.method).toBe('POST');
      expect(r.headers.get('authorization')).toBe('Bearer test-cron-secret');
    }
    expect(fetchHandler.mock.calls[0][1]).toBe(env);
    expect(fetchHandler.mock.calls[0][2]).toBe(ctx);
  });

  it('continues after a failing or throwing job and logs without the secret', async () => {
    const fetchHandler = vi
      .fn<Handler>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await runScheduled('* * * * *', SWEEP_MINUTE, env, ctx, fetchHandler);

    expect(fetchHandler).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith('[cron/scheduled] run complete', { cron: '* * * * *', jobs: 2, failed: 2 });
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('test-cron-secret');
  });

  it('runs the hourly job due at Monday 15:00', async () => {
    const fetchHandler = okHandler();
    await runScheduled('0 * * * *', MONDAY_15_UTC, env, ctx, fetchHandler);
    expect(fetchHandler).toHaveBeenCalledTimes(1);
    expect(new URL(fetchHandler.mock.calls[0][0].url).pathname).toBe('/api/cron/voice-reactivation');
  });

  it('falls back to process.env.CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'from-process-env');
    const fetchHandler = okHandler();
    await runScheduled('* * * * *', new Date('2026-11-16T10:03:00Z'), {}, ctx, fetchHandler);
    expect(fetchHandler.mock.calls[0][0].headers.get('authorization')).toBe('Bearer from-process-env');
  });

  it('runs nothing and logs when no secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const fetchHandler = okHandler();
    await runScheduled('* * * * *', SWEEP_MINUTE, {}, ctx, fetchHandler);
    expect(fetchHandler).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an unknown cron expression', async () => {
    const fetchHandler = okHandler();
    await runScheduled('5 4 * * *', SWEEP_MINUTE, env, ctx, fetchHandler);
    expect(fetchHandler).not.toHaveBeenCalled();
  });
});
