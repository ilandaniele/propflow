import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/rls/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/finance/**',
        'src/lib/kpi.ts',
        'src/lib/schemas/**',
        'src/lib/errors.ts',
        'src/lib/log.ts',
        'src/lib/ratelimit.ts',
      ],
      exclude: ['**/*.d.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
