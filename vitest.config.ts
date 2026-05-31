import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/rls/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    env: {
      // Stub values for unit tests — not real credentials
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder_anon_key',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/finance/**',
        'src/lib/kpi.ts',
        'src/lib/schemas/**',
        'src/lib/errors.ts',
        'src/lib/log.ts',
        'src/lib/ratelimit.ts',
        'src/lib/events/**',
        'src/lib/whatsapp/**',
        'src/lib/tenants/**',
        'src/lib/i18n/**',
        'src/lib/ocr/**',
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
