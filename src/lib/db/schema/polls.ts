import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { id, ts } from './columns';
import { organizations, profiles } from './core';

export const polls = sqliteTable('polls', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  question:  text('question').notNull(),
  closesAt:  ts('closes_at'),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_polls_org_created').on(t.orgId, t.createdAt),
]);

export const pollOptions = sqliteTable('poll_options', {
  id:       id(),
  pollId:   text('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  label:    text('label').notNull(),
  position: integer('position').notNull(),
}, (t) => [
  index('idx_poll_options_poll').on(t.pollId),
]);

export const pollVotes = sqliteTable('poll_votes', {
  id:        id(),
  pollId:    text('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  optionId:  text('option_id').notNull().references(() => pollOptions.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('idx_poll_votes_one_per_profile').on(t.pollId, t.profileId),
  index('idx_poll_votes_option').on(t.optionId),
]);
