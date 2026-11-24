import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ts } from './columns';
import { organizations } from './core';

export const orgBranding = sqliteTable('org_branding', {
  orgId:       text('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  logoKey:     text('logo_key'),
  accentColor: text('accent_color'),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
});
