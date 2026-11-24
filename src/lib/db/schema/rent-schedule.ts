import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { bool, ts } from './columns';
import { organizations } from './core';

export const rentScheduleSettings = sqliteTable('rent_schedule_settings', {
  orgId:     text('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  enabled:   bool('enabled').notNull().default(false),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
});
