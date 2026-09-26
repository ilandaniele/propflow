/**
 * The agent eval harness's actual runner (master plan §"Verificación" — Eval:
 * "30 a 50 conversaciones guionadas ... Corre contra la API real ... fuera
 * del CI por defecto"). Written as a vitest spec (not a plain script) so it
 * can `vi.mock('@/lib/db')` to redirect every agent module at the seeded
 * PGlite instance — the same trick tests/integration/sql-smoke/*.test.ts
 * uses — while still calling the REAL Anthropic API.
 *
 * NEVER run this directly with `vitest run scripts/agent-eval/eval.spec.ts`
 * — it is excluded from vitest.config.ts's `include` on purpose. The only
 * supported entry point is `pnpm agent:eval` (scripts/agent-eval/run.ts),
 * which refuses to spawn this file unless AGENT_EVAL=1 and ANTHROPIC_API_KEY
 * are both set, and which renders this file's results into a markdown report.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSmokeDb, type SmokeDb } from '../../tests/integration/sql-smoke/setup';
import { FIXTURES } from './fixtures';
import { seedScenario, loadSessionToolTrace } from './db-helpers';
import { evaluateFixture, type TranscriptTurn } from './assertions';
import type { EvalFixture } from './schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

export interface EvalFixtureResult {
  fixture: EvalFixture;
  turns: TranscriptTurn[];
  failures: Array<{ rule: string; detail: string }>;
}

/** Populated as fixtures run — run.ts reads this (via the JSON file below) to render the markdown report. */
const results: EvalFixtureResult[] = [];
const RESULTS_PATH = path.resolve(__dirname, '.eval-results.json');

let smoke: { db: SmokeDb; close: () => Promise<void> };

const CAN_RUN = process.env.AGENT_EVAL === '1' && !!process.env.ANTHROPIC_API_KEY;

beforeAll(async () => {
  if (!CAN_RUN) return;
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  if (!CAN_RUN) return;
  await smoke.close();
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
});

describe('agent eval — scripted conversations (real Anthropic API)', () => {
  // Defense in depth: run.ts already refuses to invoke vitest without these
  // env vars, but a stray `vitest run --config vitest.eval.config.ts` must
  // still refuse instead of silently spending real API budget.
  it.skipIf(!CAN_RUN)('refusal guard is a no-op once AGENT_EVAL=1 + ANTHROPIC_API_KEY are set', () => {
    expect(CAN_RUN).toBe(true);
  });

  it.runIf(!CAN_RUN)('refuses without AGENT_EVAL=1 + ANTHROPIC_API_KEY', () => {
    expect(CAN_RUN).toBe(false);
  });

  for (const fixture of FIXTURES) {
    it.runIf(CAN_RUN)(`${fixture.id} — ${fixture.title}`, async () => {
      // Dynamic import so `@/lib/db`'s mock (set above) is in place before
      // run-turn.ts and its dependencies resolve their own `import { db }`.
      const { runAgentTurn } = await import('@/lib/agent/run-turn');

      const scenario = await seedScenario(smoke.db, fixture);
      const turns: TranscriptTurn[] = [];

      for (const userText of fixture.turns) {
        const result = await runAgentTurn({
          orgId: scenario.orgId,
          channel: fixture.channel,
          externalId: scenario.externalId,
          inboundText: userText,
          dryRun: true,
        });
        turns.push({ userText, replyText: result.replyText, handedOffToHuman: result.handedOffToHuman });
      }

      const trace = await loadSessionToolTrace(smoke.db, scenario.orgId, scenario.externalId);
      const failures = evaluateFixture(fixture, turns, trace);
      results.push({ fixture, turns, failures });

      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });
  }
});
