# Agent eval harness

Scripted, multi-turn conversations that exercise `runAgentTurn` (`src/lib/agent/run-turn.ts`)
against the **real Anthropic API**, in Spanish from Peru, Colombia and Argentina plus a couple
of English/voice-style scenarios. This is **not** part of CI or `pnpm test:unit` — it spends
real API budget and its verdicts depend on model behaviour, not just code correctness.

## Running it

```
AGENT_EVAL=1 ANTHROPIC_API_KEY=sk-... pnpm agent:eval
```

`scripts/agent-eval/run.ts` refuses immediately unless both env vars are set. When allowed, it:

1. Spawns `vitest run --config vitest.eval.config.ts`, which runs `scripts/agent-eval/eval.spec.ts`.
2. That spec seeds a fresh PGlite database per fixture (same helpers as
   `tests/integration/sql-smoke/setup.ts`), mocks `@/lib/db` to point at it, and runs each
   fixture's turns through `runAgentTurn(..., { dryRun: true })` — no real WhatsApp/Meta calls,
   no money spent on visits, no real org's budget touched.
3. Every fixture's transcript is checked against deterministic assertions
   (`scripts/agent-eval/assertions.ts`): no invented prices, booked slot ids were actually
   offered in that session, qualification fields were asked about, `handoff_to_human` fired on
   complaints, no tenant data leaked to a prospect.
4. `run.ts` renders the results into `scripts/agent-eval/report.md` and exits non-zero if any
   scenario failed.

## Files

- `schema.ts` — the `EvalFixture` zod schema + shared types.
- `fixtures.ts` — 30+ scripted conversations (Zod-validated by
  `tests/unit/agent-eval/fixtures.test.ts`, which runs in CI with no network access).
- `assertions.ts` — pure, DB-free assertion functions run against a fixture's transcript.
- `db-helpers.ts` — seeds one org/config/listings/advisor per fixture and extracts the
  offered-vs-used slot ids from the session's persisted `agent_messages`.
- `eval.spec.ts` — the vitest spec that actually drives `runAgentTurn` against the real API
  (only reachable through `pnpm agent:eval`, never directly).
- `report.ts` — renders the collected results into markdown.
- `run.ts` — the CLI entry point (`pnpm agent:eval`); the only supported way to run this suite.

## Adding a fixture

Add an entry to the `FIXTURES` array in `fixtures.ts` following `EvalFixture`'s shape, then run
`pnpm test:unit tests/unit/agent-eval` to confirm it validates before spending API budget on it.
