// Edge rate limiting (docs/07 §4.5). Outside a Worker (next dev, vitest) there are
// no bindings, so every check allows the request.

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { log } from '@/lib/log';

export type LimitResult = { success: boolean; retryAfterMs: number };

export type IpLimitBinding = 'RL_IP_API' | 'RL_IP_AUTH';

/** Period configured for the RL_IP_* bindings in wrangler config (60 s). */
const IP_LIMIT_PERIOD_MS = 60_000;

const ALLOW: LimitResult = { success: true, retryAfterMs: 0 };

function getEnv(): CloudflareEnv | null {
  try {
    return getCloudflareContext().env;
  } catch {
    return null;
  }
}

export async function limitIp(binding: IpLimitBinding, ip: string): Promise<LimitResult> {
  const limiter = getEnv()?.[binding];
  if (!limiter) return ALLOW;
  try {
    const { success } = await limiter.limit({ key: ip });
    return success ? ALLOW : { success: false, retryAfterMs: IP_LIMIT_PERIOD_MS };
  } catch (e) {
    // Fail open: a limiter outage must not take the whole site down.
    log.warn('[ratelimit-edge] binding limit failed', {
      binding,
      code: e instanceof Error ? e.message : 'unknown',
    });
    return ALLOW;
  }
}

// SQLite evaluates every DO UPDATE SET expression against the OLD row, so both
// CASEs test the pre-update window_start. ?1 key, ?2 now, ?3 now - windowMs.
const FIXED_WINDOW_SQL = `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
ON CONFLICT(key) DO UPDATE SET
  count = CASE WHEN rate_limits.window_start <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
  window_start = CASE WHEN rate_limits.window_start <= ?3 THEN ?2 ELSE rate_limits.window_start END
RETURNING count, window_start`;

/** Fixed window in D1: `limit` calls per `windowMs` per `key`. Writes one row per call. */
export async function limitKeyD1(key: string, limit: number, windowMs: number): Promise<LimitResult> {
  const db = getEnv()?.DB;
  if (!db) return ALLOW;

  const now = Date.now();
  try {
    const row = await db
      .prepare(FIXED_WINDOW_SQL)
      .bind(key, now, now - windowMs)
      .first<{ count: number; window_start: number }>();
    if (!row) return ALLOW;
    if (row.count <= limit) return ALLOW;
    return { success: false, retryAfterMs: Math.max(0, row.window_start + windowMs - now) };
  } catch (e) {
    log.warn('[ratelimit-edge] d1 limit failed', {
      code: e instanceof Error ? e.message : 'unknown',
    });
    return ALLOW;
  }
}
