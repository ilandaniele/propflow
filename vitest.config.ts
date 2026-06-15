import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/vitest.setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/rls/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    env: {
      // Stub values for unit tests — not real credentials
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder_anon_key',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
      AUTH_SECRET: 'placeholder-secret-for-tests-only-32chars',
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/finance/**',
        'src/lib/schemas/**',
        'src/lib/errors.ts',
        'src/lib/log.ts',
        'src/lib/ratelimit.ts',
        'src/lib/events/**',
        'src/lib/whatsapp/**',
        'src/lib/tenants/**',
        'src/lib/i18n/**',
        'src/lib/ocr/**',
        'src/lib/airtable/**',
        'src/lib/ai/**',
        'src/lib/storage/**',
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
      // next-auth/lib/env.js uses bare `import { NextRequest } from 'next/server'`
      // Node's native ESM resolver requires the .js extension.
      // Map the bare specifier to the explicit .js file so vitest can resolve it.
      'next/server': path.resolve(__dirname, 'node_modules/next/server.js'),
    },
  },
});
