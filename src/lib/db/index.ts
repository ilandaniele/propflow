import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL env var is required');
}

// Singleton pattern: reuse connection across hot-reloads in development
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: ReturnType<typeof postgres> | undefined;
}

const pgPool: ReturnType<typeof postgres> =
  globalThis.__pgPool ?? postgres(DATABASE_URL, { max: 10 });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__pgPool = pgPool;
}

export const db = drizzle(pgPool, { schema });
export { pgPool };
export type DB = typeof db;
