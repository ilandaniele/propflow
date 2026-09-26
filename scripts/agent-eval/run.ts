/**
 * CLI entry point for the agent eval harness (`pnpm agent:eval`).
 *
 * Refuses outright unless both AGENT_EVAL=1 and ANTHROPIC_API_KEY are set —
 * this suite spends real Anthropic budget and must never run by accident
 * (not in CI, not from `pnpm test:unit`). Once allowed, it delegates the
 * actual conversations to eval.spec.ts under vitest.eval.config.ts (vitest
 * gives us `vi.mock('@/lib/db')` to point every agent module at a seeded
 * PGlite instance — a plain `tsx` script can't do that kind of module
 * substitution without extra deps), then renders the collected results into
 * a markdown report.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdownReport } from './report';
import type { EvalFixtureResult } from './eval.spec';

const ROOT = path.resolve(__dirname, '../..');
const RESULTS_PATH = path.resolve(__dirname, '.eval-results.json');
const REPORT_PATH = path.resolve(__dirname, 'report.md');

function refuse(reason: string): never {
  console.error(`[agent-eval] refusing to run: ${reason}`);
  console.error('[agent-eval] set AGENT_EVAL=1 and ANTHROPIC_API_KEY to run the real-API eval suite.');
  process.exit(1);
}

function main(): void {
  if (process.env.AGENT_EVAL !== '1') refuse('AGENT_EVAL=1 is not set');
  if (!process.env.ANTHROPIC_API_KEY) refuse('ANTHROPIC_API_KEY is not set');

  // Stale results from a previous run must never be reported as this run's.
  if (fs.existsSync(RESULTS_PATH)) fs.rmSync(RESULTS_PATH);

  const vitest = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.eval.config.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  if (!fs.existsSync(RESULTS_PATH)) {
    console.error('[agent-eval] eval.spec.ts produced no results file — see vitest output above.');
    process.exit(vitest.status ?? 1);
  }

  const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')) as EvalFixtureResult[];
  const markdown = renderMarkdownReport(results);
  fs.writeFileSync(REPORT_PATH, markdown);

  const failed = results.filter((r) => r.failures.length > 0).length;
  console.log(`[agent-eval] ${results.length - failed}/${results.length} scenarios passed. Report: ${REPORT_PATH}`);

  process.exit(failed > 0 || (vitest.status ?? 0) !== 0 ? 1 : 0);
}

main();
