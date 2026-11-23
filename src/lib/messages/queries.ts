import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { profiles, tenantMessages } from '@/lib/db/schema';
import type { MessageKind, MessageStatus } from './schemas';

const PAGE_LIMIT = 100;

const messageColumns = {
  id: tenantMessages.id,
  kind: tenantMessages.kind,
  subject: tenantMessages.subject,
  body: tenantMessages.body,
  status: tenantMessages.status,
  reply: tenantMessages.reply,
  repliedAt: tenantMessages.repliedAt,
  createdAt: tenantMessages.createdAt,
};

export async function listInboxMessages(orgId: string, status?: MessageStatus) {
  return db
    .select({ ...messageColumns, senderName: profiles.fullName })
    .from(tenantMessages)
    .leftJoin(profiles, eq(profiles.id, tenantMessages.senderId))
    .where(and(eq(tenantMessages.orgId, orgId), status ? eq(tenantMessages.status, status) : undefined))
    .orderBy(desc(tenantMessages.createdAt))
    .limit(PAGE_LIMIT);
}

export async function listSentMessages(orgId: string, senderId: string) {
  return db
    .select(messageColumns)
    .from(tenantMessages)
    .where(and(eq(tenantMessages.orgId, orgId), eq(tenantMessages.senderId, senderId)))
    .orderBy(desc(tenantMessages.createdAt))
    .limit(PAGE_LIMIT);
}

export async function insertTenantMessage(input: { orgId: string; senderId: string; kind: MessageKind; subject: string; body: string }) {
  const [row] = await db.insert(tenantMessages).values(input).returning({ id: tenantMessages.id });
  return row.id;
}

export async function replyToMessage(input: { orgId: string; messageId: string; reply: string; repliedBy: string }) {
  const rows = await db
    .update(tenantMessages)
    .set({ reply: input.reply, repliedBy: input.repliedBy, repliedAt: new Date(), status: 'answered' })
    .where(and(eq(tenantMessages.id, input.messageId), eq(tenantMessages.orgId, input.orgId)))
    .returning({ id: tenantMessages.id });
  return rows.length > 0;
}

export async function closeMessage(orgId: string, messageId: string) {
  const rows = await db
    .update(tenantMessages)
    .set({ status: 'closed' })
    .where(and(eq(tenantMessages.id, messageId), eq(tenantMessages.orgId, orgId), ne(tenantMessages.status, 'closed')))
    .returning({ id: tenantMessages.id });
  return rows.length > 0;
}
