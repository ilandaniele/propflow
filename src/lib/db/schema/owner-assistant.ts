import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, ts } from './columns';
import { organizations, profiles } from './core';

/** An admin's WhatsApp number linked to the owner assistant. Verified when the admin sends the code from that number. */
export const ownerAssistantLinks = sqliteTable('owner_assistant_links', {
  id:            id(),
  orgId:         text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:     text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  phoneE164:     text('phone_e164').notNull(),
  codeHash:      text('code_hash'),
  codeExpiresAt: ts('code_expires_at'),
  attempts:      integer('attempts').notNull().default(0),
  verifiedAt:    ts('verified_at'),
  createdAt:     ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:     ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('owner_assistant_links_profile_uniq').on(t.profileId),
  uniqueIndex('owner_assistant_links_org_phone_uniq').on(t.orgId, t.phoneE164),
  check('owner_assistant_links_attempts_check', sql`attempts >= 0`),
]);

/** One row per inbound WhatsApp message handled by the assistant: idempotency on Meta retries plus an audit trail. */
export const ownerAssistantMessages = sqliteTable('owner_assistant_messages', {
  id:                id(),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  linkId:            text('link_id').references(() => ownerAssistantLinks.id, { onDelete: 'set null' }),
  providerMessageId: text('provider_message_id').notNull(),
  kind:              text('kind').notNull(),
  outcome:           text('outcome').notNull().default('received'),
  recordId:          text('record_id'),
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('owner_assistant_messages_provider_uniq').on(t.providerMessageId),
  index('idx_owner_assistant_messages_org').on(t.orgId, t.createdAt),
]);
