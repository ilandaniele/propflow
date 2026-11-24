import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, profiles } from './core';

export const activityEvents = sqliteTable('activity_events', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actorId:      text('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
  action:       text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId:   text('resource_id'),
  summary:      text('summary'),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_activity_events_org_created').on(t.orgId, t.createdAt),
]);
