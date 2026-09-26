import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Separate config for the agent eval harness (scripts/agent-eval/run.ts).
 * Deliberately NOT part of vitest.config.ts's `include` — the eval spec
 * calls the real Anthropic API and must never run under `pnpm test:unit` or
 * in CI. Only `pnpm agent:eval` (which refuses without AGENT_EVAL=1 +
 * ANTHROPIC_API_KEY) points at this config.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/agent-eval/eval.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    retry: 0,
    // Fixtures run sequentially against one shared PGlite instance — no benefit
    // to file-level parallelism here, and it would just interleave API calls.
    fileParallelism: false,
    env: {
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
      AUTH_SECRET: 'placeholder-secret-for-tests-only-32chars',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'next/server': path.resolve(__dirname, 'node_modules/next/server.js'),
    },
  },
});
