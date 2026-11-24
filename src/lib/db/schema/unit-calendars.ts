import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { dateStr, id, ts } from './columns';
import { organizations, units } from './core';

export const unitCalendars = sqliteTable('unit_calendars', {
  id:            id(),
  orgId:         text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:        text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  exportToken:   text('export_token').notNull(),
  importUrl:     text('import_url'),
  lastSyncedAt:  ts('last_synced_at'),
  lastSyncError: text('last_sync_error'),
  createdAt:     ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:     ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('unit_calendars_unit_uidx').on(t.unitId),
  uniqueIndex('unit_calendars_token_uidx').on(t.exportToken),
  index('idx_unit_calendars_synced').on(t.lastSyncedAt),
]);

export const unitExternalBlocks = sqliteTable('unit_external_blocks', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:     text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  calendarId: text('calendar_id').notNull().references(() => unitCalendars.id, { onDelete: 'cascade' }),
  uid:        text('uid').notNull(),
  startsOn:   dateStr('starts_on').notNull(),
  endsOn:     dateStr('ends_on').notNull(),
  summary:    text('summary'),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('unit_external_blocks_calendar_uid_uidx').on(t.calendarId, t.uid),
  index('idx_unit_external_blocks_unit_start').on(t.orgId, t.unitId, t.startsOn),
]);
