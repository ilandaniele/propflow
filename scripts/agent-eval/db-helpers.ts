/**
 * Scenario seeding + transcript extraction for the eval harness. Builds on
 * tests/integration/sql-smoke/setup.ts's SmokeDb/seed helpers (same PGlite
 * DB the SQL-smoke integration tests use) instead of re-inventing seeding.
 */

import { and, eq, asc } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import {
  type SmokeDb,
  seedOrg,
  seedProfile,
  seedAgentConfig,
  seedListing,
  seedAdvisorSettings,
} from '../../tests/integration/sql-smoke/setup';
import type { EvalFixture } from './schema';
import { extractSlotIds } from './assertions';
import type { SessionToolTrace } from './assertions';

export interface EvalScenario {
  orgId: string;
  /** externalId used as this fixture's whatsapp/web/voice session key — unique per fixture so sessions never collide. */
  externalId: string;
}

const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

/** Seeds one org, its agent config, the fixture's listings, and (optionally) one advisor with Mon-Fri 09:00-18:00 availability. */
export async function seedScenario(db: SmokeDb, fixture: EvalFixture): Promise<EvalScenario> {
  const org = await seedOrg(db, { name: `Eval Org — ${fixture.id}` });
  await seedAgentConfig(db, org.id, { timezone: 'America/Lima' });

  for (const listing of fixture.seed.listings) {
    await seedListing(db, org.id, {
      operation: listing.operation,
      price: listing.price != null ? String(listing.price) : null,
      currency: listing.currency,
      title: listing.title,
      zone: listing.zone ?? null,
      bedrooms: listing.bedrooms ?? null,
      bathrooms: listing.bathrooms ?? null,
      areaM2: listing.areaM2 != null ? String(listing.areaM2) : null,
      petsAllowed: listing.petsAllowed ?? null,
      maintenanceFee: listing.maintenanceFee != null ? String(listing.maintenanceFee) : null,
      published: true,
      status: 'available',
    });
  }

  if (fixture.seed.advisor) {
    const advisor = await seedProfile(db, org.id, { role: 'admin', fullName: 'Asesor Eval', email: `advisor-${fixture.id}@eval.local` });
    await seedAdvisorSettings(db, org.id, advisor.id);
    for (const weekday of WEEKDAYS_MON_FRI) {
      await db.insert(schema.agentAvailability).values({
        orgId: org.id,
        profileId: advisor.id,
        weekday,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      });
    }
  }

  // A decoy tenant, never wired to any agent tool (agent tools only ever read
  // listings/crm_leads/agent_* tables) — if it leaks into a reply, a tool or
  // the model itself crossed the tenant/prospect wall (blueprint §"Seguridad").
  if (fixture.seed.decoyTenantName) {
    await db.insert(schema.tenants).values({ orgId: org.id, fullName: fixture.seed.decoyTenantName, phone: '+51999000111' });
  }

  return { orgId: org.id, externalId: `eval-${fixture.id}` };
}

/** Every agent_messages row for this session, oldest first — the raw content-block history runAgentTurn persisted. */
async function loadSessionMessages(db: SmokeDb, orgId: string, externalId: string) {
  const matching = await db
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(and(eq(schema.agentSessions.orgId, orgId), eq(schema.agentSessions.externalId, externalId)));
  const sessionRow = matching[0] ?? null;
  if (!sessionRow) return [];

  return db
    .select({ role: schema.agentMessages.role, content: schema.agentMessages.content })
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.sessionId, sessionRow.id))
    .orderBy(asc(schema.agentMessages.createdAt));
}

/** Walks the session's persisted content blocks to recover which slot ids were offered vs. actually used. */
export async function loadSessionToolTrace(db: SmokeDb, orgId: string, externalId: string): Promise<SessionToolTrace> {
  const rows = await loadSessionMessages(db, orgId, externalId);
  const offeredSlotIds: string[] = [];
  const usedSlotIds: string[] = [];

  for (const row of rows) {
    const blocks = Array.isArray(row.content) ? row.content : [];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block.type === 'tool_result') {
        offeredSlotIds.push(...extractSlotIds(JSON.stringify(block.content ?? '')));
      }
      if (block.type === 'tool_use' && (block.name === 'book_visit' || block.name === 'reschedule_visit')) {
        usedSlotIds.push(...extractSlotIds(JSON.stringify(block.input ?? '')));
      }
    }
  }

  return { offeredSlotIds: [...new Set(offeredSlotIds)], usedSlotIds: [...new Set(usedSlotIds)] };
}
