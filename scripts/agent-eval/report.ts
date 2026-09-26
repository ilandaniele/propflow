/**
 * Renders eval.spec.ts's collected results (scripts/agent-eval/.eval-results.json)
 * into a human-readable markdown report. Pure formatting — no DB, no network.
 */

import type { EvalFixtureResult } from './eval.spec';

export function renderMarkdownReport(results: EvalFixtureResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.failures.length === 0).length;
  const failed = total - passed;
  const now = new Date().toISOString();

  const lines: string[] = [
    '# Agent eval report',
    '',
    `Generated ${now} — ${passed}/${total} scenarios passed${failed > 0 ? `, ${failed} failed` : ''}.`,
    '',
    '| Scenario | Locale | Category | Result | Failures |',
    '|---|---|---|---|---|',
  ];

  for (const r of results) {
    const status = r.failures.length === 0 ? 'PASS' : 'FAIL';
    const detail = r.failures.map((f) => `${f.rule}: ${f.detail}`).join('; ') || '—';
    lines.push(`| ${r.fixture.id} | ${r.fixture.locale} | ${r.fixture.category} | ${status} | ${detail} |`);
  }

  lines.push('', '## Transcripts', '');
  for (const r of results) {
    lines.push(`### ${r.fixture.id} (${r.failures.length === 0 ? 'PASS' : 'FAIL'})`, '');
    for (const turn of r.turns) {
      lines.push(`- **Prospecto:** ${turn.userText}`);
      lines.push(`  **Agente:** ${turn.replyText}${turn.handedOffToHuman ? ' _(handoff)_' : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
