import { log } from '@/lib/log';

/**
 * Retry a DB operation that can transiently fail on a stale TCP connection.
 *
 * Fly.io machines auto-suspend (fly.toml: auto_stop_machines = "suspend") and
 * the unmanaged Postgres does periodic leader elections. The FIRST query after a
 * resume/election often fails immediately ("Failed query…" / "no active leader");
 * a short retry lets the pool re-establish the connection.
 *
 * Mirrors the reminder-engine retry: 3 attempts, 2s backoff. Use it to wrap the
 * ENTRY query of cron routes and other resume-sensitive request paths.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, label = 'db'): Promise<T> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < MAX_ATTEMPTS - 1) {
        log.warn(`[${label}] DB connection failed, retrying`, {
          attempt,
          error: err instanceof Error ? err.message : 'unknown',
        });
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }
  // Unreachable: the loop either returns or throws on the final attempt.
  throw new Error(`[${label}] retry exhausted`);
}

/**
 * Same idea as withDbRetry, but for voice webhook paths (blueprint §0.5):
 * the whole `tool-calls` response is budgeted at 6s and Vapi cuts off at
 * ~7.5s, so withDbRetry's 2s backoff is too slow. 2 attempts, 150ms apart.
 */
export async function withFastDbRetry<T>(fn: () => Promise<T>, label = 'db'): Promise<T> {
  const MAX_ATTEMPTS = 2;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < MAX_ATTEMPTS - 1) {
        log.warn(`[${label}] DB connection failed, fast-retrying`, {
          attempt,
          error: err instanceof Error ? err.message : 'unknown',
        });
        await new Promise((r) => setTimeout(r, 150));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`[${label}] fast retry exhausted`);
}
