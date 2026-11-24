import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { bool, updatedAt } from './columns';
import { organizations, profiles } from './core';

/** Per-profile email opt-outs (V19). A missing row means every category is on. */
export const notificationPreferences = sqliteTable('notification_preferences', {
  profileId:         text('profile_id').primaryKey().references(() => profiles.id, { onDelete: 'cascade' }),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leaseRenewalEmail: bool('lease_renewal_email').notNull().default(true),
  paymentDueEmail:   bool('payment_due_email').notNull().default(true),
  announcementsEmail: bool('announcements_email').notNull().default(true),
  updatedAt:         updatedAt(),
}, (t) => [
  index('idx_notification_preferences_org').on(t.orgId),
]);
