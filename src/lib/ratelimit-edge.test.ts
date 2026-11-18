import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getCloudflareContext = vi.fn();
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => getCloudflareContext() }));

import { limitIp, limitKeyD1 } from './ratelimit-edge';

type Row = { count: number; window_start: number };

// In-memory stand-in for D1 that applies the same fixed-window semantics as the SQL.
function fakeD1() {
  const rows = new Map<string, Row>();
  const calls: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          calls.push({ sql, args });
          const [key, now, cutoff] = args as [string, number, number];
          const old = rows.get(key);
          const next: Row =
            !old ? { count: 1, window_start: now }
            : old.window_start <= cutoff ? { count: 1, window_start: now }
            : { count: old.count + 1, window_start: old.window_start };
          rows.set(key, next);
          return next;
        },
      }),
    }),
  };
  return { db, calls };
}

function withEnv(env: Partial<CloudflareEnv>) {
  getCloudflareContext.mockReturnValue({ env });
}

beforeEach(() => {
  getCloudflareContext.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('limitIp', () => {
  it('allows when the binding allows, keyed by IP', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    withEnv({ RL_IP_API: { limit } as unknown as RateLimit });
    expect(await limitIp('RL_IP_API', '1.2.3.4')).toEqual({ success: true, retryAfterMs: 0 });
    expect(limit).toHaveBeenCalledWith({ key: '1.2.3.4' });
  });

  it('blocks with retryAfterMs 60000 when the binding rejects', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    withEnv({ RL_IP_AUTH: { limit } as unknown as RateLimit });
    expect(await limitIp('RL_IP_AUTH', '1.2.3.4')).toEqual({ success: false, retryAfterMs: 60_000 });
  });

  it('allows when not running in a Worker', async () => {
    getCloudflareContext.mockImplementation(() => { throw new Error('no context'); });
    expect(await limitIp('RL_IP_API', '1.2.3.4')).toEqual({ success: true, retryAfterMs: 0 });
  });

  it('fails open when the binding throws', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('boom'));
    withEnv({ RL_IP_API: { limit } as unknown as RateLimit });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await limitIp('RL_IP_API', '1.2.3.4')).success).toBe(true);
  });
});

describe('limitKeyD1', () => {
  it('uses one UPSERT ... RETURNING statement bound to key, now and window cutoff', async () => {
    const { db, calls } = fakeD1();
    withEnv({ DB: db as unknown as D1Database });
    await limitKeyD1('login:a', 3, 10_000);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO rate_limits[\s\S]*ON CONFLICT\(key\) DO UPDATE[\s\S]*RETURNING count, window_start/);
    expect(calls[0].args).toEqual(['login:a', 1_000_000, 990_000]);
  });

  it('allows up to the limit, then blocks until the window ends', async () => {
    const { db } = fakeD1();
    withEnv({ DB: db as unknown as D1Database });
    for (let i = 0; i < 3; i++) expect((await limitKeyD1('k', 3, 10_000)).success).toBe(true);

    vi.setSystemTime(1_004_000);
    expect(await limitKeyD1('k', 3, 10_000)).toEqual({ success: false, retryAfterMs: 6_000 });
  });

  it('resets the count once the window has elapsed', async () => {
    const { db } = fakeD1();
    withEnv({ DB: db as unknown as D1Database });
    for (let i = 0; i < 4; i++) await limitKeyD1('k', 3, 10_000);

    vi.setSystemTime(1_010_000);
    expect(await limitKeyD1('k', 3, 10_000)).toEqual({ success: true, retryAfterMs: 0 });
  });

  it('keeps keys independent', async () => {
    const { db } = fakeD1();
    withEnv({ DB: db as unknown as D1Database });
    await limitKeyD1('a', 1, 10_000);
    expect((await limitKeyD1('a', 1, 10_000)).success).toBe(false);
    expect((await limitKeyD1('b', 1, 10_000)).success).toBe(true);
  });

  it('allows when not running in a Worker', async () => {
    getCloudflareContext.mockImplementation(() => { throw new Error('no context'); });
    expect(await limitKeyD1('k', 1, 10_000)).toEqual({ success: true, retryAfterMs: 0 });
  });

  it('fails open when D1 throws', async () => {
    const db = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error('d1 down')) }) }) };
    withEnv({ DB: db as unknown as D1Database });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await limitKeyD1('k', 1, 10_000)).success).toBe(true);
  });
});
