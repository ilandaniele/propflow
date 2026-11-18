import { getCloudflareContext } from '@opennextjs/cloudflare';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import type { SQLWrapper } from 'drizzle-orm';
import * as schema from './schema';

/**
 * D1 client (W-CF-11).
 *
 * On Cloudflare Workers there is no long-lived connection pool: the D1 binding
 * (`env.DB`) is only reachable through the request context that
 * @opennextjs/cloudflare stores on the global scope. So the client is built
 * lazily, on first use inside a request, never at import time.
 *
 * `getCloudflareContext()` is used in sync mode: it works in route handlers,
 * server actions and dynamic RSC (prod: set by the worker entrypoint; dev: set by
 * `initOpenNextCloudflareForDev` in next.config). It throws in SSG / at the top
 * level of a module — DB access there was never valid anyway (no real DB calls
 * during static page data collection).
 */
export type DB = DrizzleD1Database<typeof schema>;

/** Transitional alias: Postgres-era `db.execute(sql)` maps to D1 `db.all(sql)` (returns rows). */
export type DBWithExecute = DB & {
  execute<T = Record<string, unknown>>(query: SQLWrapper | string): Promise<T[]>;
};

// One drizzle instance per D1 binding object. The binding is stable across
// requests in the same isolate; WeakMap lets it be collected if it is replaced.
const cache = new WeakMap<object, DB>();

let testDb: DB | null = null;

/**
 * Test-only override (D1 test harness / unit tests). Pass `null` to clear.
 * Refused in production so it can never shadow the real binding.
 */
export function __setTestDb(d: DB | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__setTestDb is test-only');
  }
  testDb = d;
}

export function getDb(): DB {
  if (testDb) return testDb;
  const binding = getCloudflareContext().env.DB;
  if (!binding) {
    throw new Error('D1 binding "DB" is not configured (check wrangler config)');
  }
  let instance = cache.get(binding);
  if (!instance) {
    instance = drizzle(binding, { schema });
    cache.set(binding, instance);
  }
  return instance;
}

/**
 * Lazy proxy so existing `import { db } from '@/lib/db'` call sites keep working.
 *
 * The proxy target is a bare object whose prototype is DrizzleD1Database.prototype.
 * That keeps `instanceof` / drizzle's `is(db, BaseSQLiteDatabase)` true at import
 * time (DrizzleAdapter checks the dialect when auth config loads) without touching
 * the Cloudflare context. Every property access resolves against `getDb()`.
 */
const target = Object.create(DrizzleD1Database.prototype) as DB;

export const db: DBWithExecute = new Proxy(target, {
  get(_t, prop) {
    const real = getDb();
    if (prop === 'execute') {
      return real.all.bind(real);
    }
    const value: unknown = Reflect.get(real, prop, real);
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
  has(_t, prop) {
    return prop === 'execute' || Reflect.has(getDb(), prop);
  },
}) as DBWithExecute;
