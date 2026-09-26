/**
 * Real-SQL smoke harness (Phase 8-9 follow-up): unit tests mock `@/lib/db`
 * wholesale, so a bad `::date` cast, a typo'd column, an invalid
 * `GROUPING SETS`, or a driver-shape mismatch never touches real Postgres
 * SQL parsing. This harness runs the actual migrations against PGlite
 * (Postgres compiled to WASM) and hands back a drizzle client that talks to
 * it, so the functions under test in tests/integration/sql-smoke/*.test.ts
 * run their real queries.
 *
 * IMPORTANT driver-shape gotcha: production's `db` (drizzle-orm/postgres-js)
 * returns `db.execute(sql\`...\`)` as a plain array of rows — every raw-SQL
 * caller (metrics.ts, scanners.ts, routing.ts...) relies on that (`for (const
 * row of rows)`, `rows[0]`, `rows.map(...)`). drizzle-orm/pglite's
 * `db.execute()` instead returns the full `{ rows, fields, ... }` result
 * object. `createSmokeDb()` wraps `.execute` to unwrap `.rows` so the
 * returned object matches postgres-js's shape — the same contract
 * production code (and its unit-test mocks) already assumes.
 */

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from '@/lib/db/schema';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../src/lib/db/migrations');

type PgliteDrizzle = ReturnType<typeof drizzle<typeof schema>>;

/** The subset of `@/lib/db`'s exported `db` surface production code calls. */
export type SmokeDb = PgliteDrizzle & { execute: (query: unknown) => Promise<unknown[]> };

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const text = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await pg.exec(text);
  }
}

/**
 * Creates a fresh in-memory Postgres (PGlite) with every migration applied,
 * wrapped in a drizzle client whose `.execute()` matches postgres-js's
 * array-of-rows shape. Call once per test file (module-level `beforeAll`) —
 * migrating is ~150-300ms, but the PGlite WASM cold start dominates, so
 * sharing one instance across a file's tests (not creating one per test)
 * keeps the whole suite well under budget.
 */
export async function createSmokeDb(): Promise<{ db: SmokeDb; close: () => Promise<void> }> {
  const pg = await PGlite.create({ extensions: { pgcrypto, btree_gist } });
  await applyMigrations(pg);

  const raw = drizzle(pg, { schema }) as PgliteDrizzle;
  const rawExecute = raw.execute.bind(raw);
  const db = raw as SmokeDb;
  db.execute = (async (query: unknown) => {
    const result = (await rawExecute(query as never)) as unknown as { rows: unknown[] };
    return result.rows;
  }) as SmokeDb['execute'];

  return { db, close: () => pg.close() };
}

// ── minimal seed helpers ─────────────────────────────────────────────────
// Every helper takes `db` explicitly (rather than closing over a shared
// instance) so tests can seed against whichever SmokeDb their file created.

export async function seedOrg(db: SmokeDb, overrides: Partial<typeof schema.organizations.$inferInsert> = {}) {
  const [row] = await db.insert(schema.organizations).values({ name: 'Smoke Org', ...overrides }).returning();
  return row;
}

export async function seedProfile(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.profiles.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.profiles)
    .values({ orgId, role: 'admin', fullName: 'Advisor', email: 'advisor@example.com', ...overrides })
    .returning();
  return row;
}

export async function seedAgentConfig(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.agentConfigs.$inferInsert> = {},
) {
  const [row] = await db.insert(schema.agentConfigs).values({ orgId, ...overrides }).returning();
  return row;
}

export async function seedLead(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.crmLeads.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.crmLeads)
    .values({ orgId, fullName: 'Lead One', ...overrides })
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
    .values({ orgId, channel: 'whatsapp', externalId: `ext-${Math.random()}`, ...overrides })
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
    .values({ orgId, sessionId, role: 'user', content: {}, ...overrides })
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
    .values({ orgId, sessionId, kind: 'handoff', data: {}, ...overrides })
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
  const [row] = await db.insert(schema.propertyVisits).values({ orgId, ...overrides }).returning();
  return row;
}

export async function seedCall(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.agentCalls.$inferInsert> & { direction: string; purpose: string },
) {
  const [row] = await db.insert(schema.agentCalls).values({ orgId, ...overrides }).returning();
  return row;
}

export async function seedProperty(db: SmokeDb, orgId: string, overrides: Partial<typeof schema.properties.$inferInsert> = {}) {
  const [row] = await db.insert(schema.properties).values({ orgId, name: 'Smoke Property', ...overrides }).returning();
  return row;
}

export async function seedListing(
  db: SmokeDb,
  orgId: string,
  overrides: Partial<typeof schema.listings.$inferInsert> & { operation: string },
) {
  const [row] = await db.insert(schema.listings).values({ orgId, ...overrides }).returning();
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
    .values({ orgId, profileId, ...overrides })
    .returning();
  return row;
}

/** Sanity check used once per file — fails loudly instead of every downstream test if migrations silently no-op. */
export async function assertMigrated(db: SmokeDb): Promise<void> {
  const rows = (await db.execute(sql`SELECT to_regclass('public.property_visits') AS reg`)) as Array<{ reg: string | null }>;
  if (!rows[0]?.reg) throw new Error('[sql-smoke/setup] migrations did not apply — property_visits table is missing');
}
