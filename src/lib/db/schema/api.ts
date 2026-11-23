import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, profiles } from './core';

export const apiKeys = sqliteTable('api_keys', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  prefix:     text('prefix').notNull(),
  keyHash:    text('key_hash').notNull(),
  createdBy:  text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  lastUsedAt: ts('last_used_at'),
  revokedAt:  ts('revoked_at'),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('idx_api_keys_hash').on(t.keyHash),
  index('idx_api_keys_org').on(t.orgId),
]);
