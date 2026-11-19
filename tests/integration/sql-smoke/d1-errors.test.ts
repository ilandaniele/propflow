import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isConstraintError, isUniqueViolation } from '@/lib/db/errors';
import { createSmokeDb, seedAgentConfig, seedLead, seedOrg, seedProfile, seedVisit, type SmokeHandle } from './setup';
import { D1_ERRORS, d1ErrorChain, type D1ErrorKind } from './d1-errors.fixture';

function d1MessageOf(err: unknown): string | undefined {
  for (let cur = err as { message?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (cur.message?.startsWith('D1_ERROR: ')) return cur.message;
  }
  return undefined;
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected the statement to fail');
}

describe('src/lib/db/errors.ts on captured D1 messages', () => {
  it.each<[D1ErrorKind, boolean, boolean]>([
    ['unique', true, false],
    ['check', false, false],
    ['foreignKey', false, false],
    ['visitOverlap', false, true],
  ])('%s: isUniqueViolation=%s, isConstraintError(visit_overlap)=%s', (kind, unique, overlap) => {
    const err = d1ErrorChain(kind);
    expect(isUniqueViolation(err)).toBe(unique);
    expect(isConstraintError(err, 'visit_overlap')).toBe(overlap);
  });

  it('isUniqueViolation matches the table.column D1 reports', () => {
    expect(isUniqueViolation(d1ErrorChain('unique'), 'agent_configs.org_id')).toBe(true);
    expect(isUniqueViolation(d1ErrorChain('unique'), 'listings.slug')).toBe(false);
  });

  it('isConstraintError finds CHECK names and FK failures', () => {
    expect(isConstraintError(d1ErrorChain('check'), 'crm_leads_status_check')).toBe(true);
    expect(isConstraintError(d1ErrorChain('foreignKey'), 'FOREIGN KEY constraint failed')).toBe(true);
  });
});

describe('captured D1 messages match live local D1', () => {
  let smoke: SmokeHandle;
  let live: Record<D1ErrorKind, unknown>;

  beforeAll(async () => {
    smoke = await createSmokeDb();
    const { db } = smoke;
    const org = await seedOrg(db);
    const profile = await seedProfile(db, org.id);
    const lead = await seedLead(db, org.id);
    await seedAgentConfig(db, org.id);
    const start = Date.now() + 3_600_000;
    const visit = {
      leadId: lead.id,
      profileId: profile.id,
      startsAt: new Date(start),
      endsAt: new Date(start + 1_800_000),
      blockedUntil: new Date(start + 2_700_000),
      sourceChannel: 'web',
      createdBy: 'agent',
    };
    await seedVisit(db, org.id, visit);

    live = {
      unique: await caught(() => seedAgentConfig(db, org.id)),
      check: await caught(() => seedLead(db, org.id, { status: 'bogus' })),
      foreignKey: await caught(() => seedLead(db, crypto.randomUUID())),
      visitOverlap: await caught(() => seedVisit(db, org.id, visit)),
    };
  });

  afterAll(async () => {
    await smoke?.close();
  });

  it.each(Object.keys(D1_ERRORS) as D1ErrorKind[])('%s', (kind) => {
    expect(d1MessageOf(live[kind])).toBe(D1_ERRORS[kind]);
  });

  it('errors.ts recognizes the live errors', () => {
    expect(isUniqueViolation(live.unique, 'agent_configs.org_id')).toBe(true);
    expect(isUniqueViolation(live.check)).toBe(false);
    expect(isUniqueViolation(live.foreignKey)).toBe(false);
    expect(isUniqueViolation(live.visitOverlap)).toBe(false);
    expect(isConstraintError(live.visitOverlap, 'visit_overlap')).toBe(true);
  });
});
