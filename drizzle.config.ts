import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema/index.ts',
  out: './src/lib/db/migrations-d1',
  dialect: 'sqlite',
} satisfies Config;
