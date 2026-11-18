/**
 * Real-SQL smoke harness on local D1 (W-CF-14). Unit tests mock `@/lib/db`
 * wholesale, so a bad SQLite function, a typo'd column or a driver-shape
 * mismatch never touches a real SQL parser. This harness boots a local D1
 * (workerd via wrangler's `getPlatformProxy()`, in memory, nothing persisted),
 * applies `src/lib/db/migrations-d1/` in `meta/_journal.json` order and hands
 * back a drizzle-orm/d1 client, so the functions under test in
 * tests/integration/sql-smoke/*.test.ts run their real queries.
 *
 * Driver shape: production's `db` (src/lib/db/index.ts) exposes the
 * Postgres-era `db.execute(sql)` as an alias of drizzle-d1's `db.all(sql)`,
 * which returns a plain array of rows. `SmokeDb.execute` does the same.
 *
 * Wiring into app code: `createSmokeDb()` also calls `__setTestDb()` on the
 * real `@/lib/db`, so code under test that imports `db` hits this D1 without a
 * mock. Test files that `vi.mock('@/lib/db', ...)` themselves keep working:
 * the mock has no `__setTestDb`, so the hook is skipped and the file's own
 * mock is the wiring. `close()` clears the hook and disposes workerd.
 *
 * Timestamps are integer epoch ms with no SQL defaults and ids are
 * app-generated UUIDs, so every seed sets `id`, `createdAt` and `updatedAt`
 * explicitly (when the table has them) instead of relying on the database.
 */

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { getTableColumns, sql, type SQLWrapper } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getPlatformProxy } from 'wrangler';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from '@/lib/db/schema';
import * as dbModule from '@/lib/db';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(ROOT, 'src/lib/db/migrations-d1');
const WRANGLER_CONFIG = path.join(ROOT, 'wrangler.jsonc');

type D1Drizzle = DrizzleD1Database<typeof schema>;

/** The subset of `@/lib/db`'s exported `db` surface production code calls. */
export type SmokeDb = D1Drizzle & {
  execute: <T = Record<string, unknown>>(query: SQLWrapper | string) => Promise<T[]>;
};

export type SmokeHandle = {
  db: SmokeDb;
  /** Raw D1 binding, for tests that need driver-level errors or `exec`. */
  d1: D1Database;
  close: () => Promise<void>;
};

/** Migration files in journal order, each split on drizzle-kit's breakpoint marker. */
export function readMigrations(): Array<{ tag: string; statements: string[] }> {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => {
      const text = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
      const statements = text
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.replace(/^--.*$/gm, '').trim().length > 0);
      return { tag, statements };
    });
}

async function applyMigrations(d1: D1Database): Promise<void> {
  for (const { tag, statements } of readMigrations()) {
    try {
      // batch() runs the file as one transaction, like `wrangler d1 migrations apply`.
      await d1.batch(statements.map((s) => d1.prepare(s)));
    } catch (err) {
      throw new Error(`[sql-smoke/setup] migration ${tag} failed: ${(err as Error).message}`, { cause: err });
    }
  }
}

function setGlobalTestDb(value: D1Drizzle | null): void {
  // A test file's own vi.mock('@/lib/db') has no __setTestDb; vitest throws on
  // reading a missing export from a factory mock, hence the try.
  let setter: ((d: D1Drizzle | null) => void) | undefined;
  try {
    setter = (dbModule as { __setTestDb?: (d: D1Drizzle | null) => void }).__setTestDb;
  } catch {
    setter = undefined;
  }
  if (typeof setter === 'function') setter(value);
}

/**
 * Boots a fresh in-memory local D1 with every migration applied. Call once per
 * test file (module-level `beforeAll`) and `close()` it in `afterAll`: each
 * call starts one workerd process (~1-2 s cold).
 */
export async function createSmokeDb(): Promise<SmokeHandle> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: WRANGLER_CONFIG,
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  const d1 = proxy.env.DB;
  try {
    await applyMigrations(d1);
  } catch (err) {
    await proxy.dispose();
    throw err;
  }

  const raw = drizzle(d1, { schema });
  const db = raw as SmokeDb;
  db.execute = (<T,>(query: SQLWrapper | string) => raw.all<T>(query)) as SmokeDb['execute'];
  setGlobalTestDb(raw);

  return {
    db,
    d1,
    close: async () => {
      setGlobalTestDb(null);
      await proxy.dispose();
    },
  };
}

// ── minimal seed helpers ─────────────────────────────────────────────────
// Every helper takes `db` explicitly (rather than closing over a shared
// instance) so tests can seed against whichever SmokeDb their file created.

/** Adds app-generated `id` / `createdAt` / `updatedAt` when the table has them; overrides win. */
function stamped<T extends SQLiteTable, V extends object>(table: T, values: V): V {
  const cols = getTableColumns(table);
  const now = new Date();
  return {
    ...('id' in cols ? { id: crypto.randomUUID() } : {}),
    ...('createdAt' in cols ? { createdAt: now } : {}),
    ...('updatedAt' in cols ? { updatedAt: now } : {}),
    ...values,
  };
}

export async function seedOrg(db: SmokeDb, overrides: Partial<typeof schema.organizations.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.organizations)
    .values(stamped(schema.organizations, { name: 'Smoke Org', ...overrides }))
    .returning();
  return row;
}

export async function seedProfile(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.profiles.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.profiles)
    .values(stamped(schema.profiles, { orgId, role: 'admin', fullName: 'Advisor', email: 'advisor@example.com', ...overrides }))
    .returning();
  return row;
}

export async function seedAgentConfig(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.agentConfigs.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.agentConfigs)
    .values(stamped(schema.agentConfigs, { orgId, ...overrides }))
    .returning();
  return row;
}

export async function seedLead(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.crmLeads.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.crmLeads)
    .values(stamped(schema.crmLeads, { orgId, fullName: 'Lead One', ...overrides }))
    .returning();
  return row;
}

export async function seedSession(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.agentSessions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.agentSessions)
    .values(stamped(schema.agentSessions, { orgId, channel: 'whatsapp', externalId: `ext-${crypto.randomUUID()}`, ...overrides }))
    .returning();
  return row;
}

export async function seedMessage(
  db: SmokeDb,
  orgId: string,
  sessionId: string,
  overrides: Partial<typeof schema.agentMessages.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.agentMessages)
    .values(stamped(schema.agentMessages, { orgId, sessionId, role: 'user', content: {}, ...overrides }))
    .returning();
  return row;
}

export async function seedEvent(
  db: SmokeDb,
  orgId: string,
  sessionId: string,
  overrides: Partial<typeof schema.agentEvents.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.agentEvents)
    .values(stamped(schema.agentEvents, { orgId, sessionId, kind: 'handoff', data: {}, ...overrides }))
    .returning();
  return row;
}

export async function seedVisit(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.propertyVisits.$inferInsert> & {
    leadId: string;
    profileId: string;
    startsAt: Date;
    endsAt: Date;
    blockedUntil: Date;
    sourceChannel: string;
    createdBy: string;
  },
) {
  const [row] = await db
    .insert(schema.propertyVisits)
    .values(stamped(schema.propertyVisits, { orgId, ...overrides }))
    .returning();
  return row;
}

export async function seedCall(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.agentCalls.$inferInsert> & { direction: string; purpose: string },
) {
  const [row] = await db
    .insert(schema.agentCalls)
    .values(stamped(schema.agentCalls, { orgId, ...overrides }))
    .returning();
  return row;
}

export async function seedProperty(db: SmokeDb, orgId: string, overrides: Partial<typeof schema.properties.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.properties)
    .values(stamped(schema.properties, { orgId, name: 'Smoke Property', ...overrides }))
    .returning();
  return row;
}

export async function seedListing(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.listings.$inferInsert> & { operation: string },
) {
  const [row] = await db
    .insert(schema.listings)
    .values(stamped(schema.listings, { orgId, ...overrides }))
    .returning();
  return row;
}

export async function seedAdvisorSettings(
  db: SmokeDb,
  orgId: string,
  profileId: string,
  overrides: Partial<typeof schema.agentAdvisorSettings.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.agentAdvisorSettings)
    .values(stamped(schema.agentAdvisorSettings, { orgId, profileId, ...overrides }))
    .returning();
  return row;
}

/** Sanity check used once per file — fails loudly instead of every downstream test if migrations silently no-op. */
export async function assertMigrated(db: SmokeDb): Promise<void> {
  const rows = await db.execute<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'property_visits'`,
  );
  if (!rows[0]?.name) throw new Error('[sql-smoke/setup] migrations did not apply — property_visits table is missing');
}
