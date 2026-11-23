import { sqliteTable, text, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, ts } from './columns';
import { organizations, profiles } from './core';
import { incidents } from './ops';

export const incidentStatusEvents = sqliteTable('incident_status_events', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status').notNull(),
  toStatus:   text('to_status').notNull(),
  changedBy:  text('changed_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_incident_status_events_incident_time').on(t.incidentId, t.createdAt),
  index('idx_incident_status_events_org').on(t.orgId),
  check('incident_status_events_to_check', sql`to_status IN ('pending','in_progress','solved')`),
]);
