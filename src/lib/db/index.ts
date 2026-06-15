import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Singleton pattern: reuse connection across hot-reloads in development
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

/**
 * Returns the shared Drizzle client.
 *
 * During `next build` (NEXT_PHASE=phase-production-build) DATABASE_URL may be absent.
 * In that case we create a no-op pool backed by a placeholder URL; the pool will never
 * be used at build time because page data collection does not make real DB calls.
 *
 * At runtime (dev or prod), missing DATABASE_URL throws immediately on first DB access.
 */
function buildDb() {
  const url = process.env.DATABASE_URL;
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build';

  if (!url && !isBuild) {
    throw new Error('DATABASE_URL env var is required');
  }

  // During build, use a dummy URL so postgres() constructs without error.
  // The pool is never actually connected during static page data collection.
  const effectiveUrl = url ?? 'postgres://build:build@localhost:5432/build';

  const pgPool: ReturnType<typeof postgres> =
    globalThis.__pgPool ?? postgres(effectiveUrl, { max: 10 });

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__pgPool = pgPool;
  }

  return drizzle(pgPool, { schema });
}

// Module-level singleton — created once per worker process.
// Not lazy so that DrizzleAdapter receives a real PgDatabase instance at import time.
export const db: ReturnType<typeof drizzle<typeof schema>> =
  (globalThis.__db as ReturnType<typeof drizzle<typeof schema>> | undefined) ?? buildDb();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__db = db;
}

export type DB = typeof db;
