import { sql } from 'drizzle-orm';
import { sqliteTable, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, users } from './core';

export const orgMemberships = sqliteTable('org_memberships', {
  id:        id(),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role:      text('role').notNull(),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('uq_org_memberships_user_org').on(t.userId, t.orgId),
  index('idx_org_memberships_org').on(t.orgId),
  check('org_memberships_role_check', sql`role IN ('admin', 'tenant')`),
]);
