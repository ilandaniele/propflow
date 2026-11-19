import { log } from '@/lib/log';

/**
 * D1 has no connection pool, so there is no stale socket to recover from.
 * Kept as a thin wrapper (removed in Ola 3): one retry only on D1 errors that
 * Cloudflare documents as transient, never on query/constraint errors.
 */
const TRANSIENT_D1_ERRORS = ['Network connection lost', 'D1_ERROR: internal error', 'reset because its code was updated'];

function isTransientD1Error(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return TRANSIENT_D1_ERRORS.some((fragment) => message.includes(fragment));
}

async function withSingleRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientD1Error(err)) throw err;
    log.warn(`[${label}] transient D1 error, retrying once`, {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return fn();
  }
}

export function withDbRetry<T>(fn: () => Promise<T>, label = 'db'): Promise<T> {
  return withSingleRetry(fn, label);
}

export function withFastDbRetry<T>(fn: () => Promise<T>, label = 'db'): Promise<T> {
  return withSingleRetry(fn, label);
}
