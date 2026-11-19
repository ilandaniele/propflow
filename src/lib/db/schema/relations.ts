import { relations } from 'drizzle-orm';
import { accounts, organizations, profiles, properties, sessions, tenants, users } from './core';
import { payments } from './finance';

export const organizationsRelations = relations(organizations, ({ many }) => ({
  profiles:   many(profiles),
  properties: many(properties),
  tenants:    many(tenants),
  payments:   many(payments),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  organization: one(organizations, { fields: [profiles.orgId], references: [organizations.id] }),
  user:         one(users, { fields: [profiles.userId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  profile:  one(profiles, { fields: [users.id], references: [profiles.userId] }),
  accounts: many(accounts),
  sessions: many(sessions),
}));
