/**
 * agent_web_sessions — the widget's opaque session identity. The bearer
 * token (`wst_<43 base64url chars>`, 32 random bytes) is stored only as its
 * sha256; the iframe keeps the raw token in localStorage and sends it as
 * `Authorization: Bearer` (Phase 7 decision 5).
 */

import { randomBytes, createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { agentWebSessions, agentMessages, agentSessions } from '@/lib/db/schema';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

export const WEB_SESSION_TTL_MS = 30 * 24 * 3600_000;
const LOCK_TTL_MS = 90_000;

export interface WebSession {
  id: string;
  orgId: string;
  agentSessionId: string | null;
  currentListingId: string | null;
  phoneE164: string | null;
  messageCount: number;
  expiresAt: Date;
}

function toWebSession(row: typeof agentWebSessions.$inferSelect): WebSession {
  return {
    id: row.id,
    orgId: row.orgId,
    agentSessionId: row.agentSessionId,
    currentListingId: row.currentListingId,
    phoneE164: row.phoneE164,
    messageCount: row.messageCount,
    expiresAt: row.expiresAt,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** sha256(`${ip}|${AUTH_SECRET}`) — never store raw IPs. */
export function hashIp(ip: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('[widget/web-session] AUTH_SECRET is required to hash IPs');
  return createHash('sha256').update(`${ip}|${secret}`).digest('hex');
}

export interface CreateWebSessionArgs {
  orgId: string;
  ipHash: string;
  origin: string | null;
  pageUrl: string | null;
}

export async function createWebSession(a: CreateWebSessionArgs): Promise<{ session: WebSession; token: string }> {
  const token = `wst_${randomBytes(32).toString('base64url')}`;
  const now = new Date();
  const rows = await db
    .insert(agentWebSessions)
    .values({
      orgId: a.orgId,
      tokenHash: hashToken(token),
      ipHash: a.ipHash,
      origin: a.origin,
      pageUrl: a.pageUrl,
      expiresAt: new Date(now.getTime() + WEB_SESSION_TTL_MS),
    })
    .returning();

  return { session: toWebSession(rows[0]), token };
}

/** Org-scoped, not expired. A token that authenticates for a different org (or has expired) returns null. */
export async function authenticateWebSession(orgId: string, token: string): Promise<WebSession | null> {
  if (!token.startsWith('wst_')) return null;
  const rows = await db
    .select()
    .from(agentWebSessions)
    .where(and(
      eq(agentWebSessions.orgId, orgId),
      eq(agentWebSessions.tokenHash, hashToken(token)),
      gt(agentWebSessions.expiresAt, new Date()),
    ))
    .limit(1);
  return rows[0] ? toWebSession(rows[0]) : null;
}

export function webSessionExternalId(webSessionId: string): string {
  return `web:${webSessionId}`;
}

export async function setWebSessionContext(
  id: string,
  p: { currentListingId?: string | null; pageUrl?: string | null },
): Promise<void> {
  await db
    .update(agentWebSessions)
    .set({
      ...(p.currentListingId !== undefined ? { currentListingId: p.currentListingId } : {}),
      ...(p.pageUrl !== undefined ? { pageUrl: p.pageUrl } : {}),
    })
    .where(eq(agentWebSessions.id, id));
}

export async function setWebSessionPhone(orgId: string, id: string, phoneE164: string): Promise<void> {
  await db
    .update(agentWebSessions)
    .set({ phoneE164, phoneCapturedAt: new Date() })
    .where(and(eq(agentWebSessions.id, id), eq(agentWebSessions.orgId, orgId)));
}

/** +1, last_message_at=now(); returns the new count. */
export async function recordWebMessage(id: string, agentSessionId: string): Promise<number> {
  const rows = await db
    .update(agentWebSessions)
    .set({
      messageCount: sql`${agentWebSessions.messageCount} + 1`,
      lastMessageAt: new Date(),
      agentSessionId,
    })
    .where(eq(agentWebSessions.id, id))
    .returning({ messageCount: agentWebSessions.messageCount });
  return rows[0]?.messageCount ?? 0;
}

/** Conditional UPDATE ... RETURNING — succeeds only if the lock is unheld or expired, mirroring tryAcquireSessionLock (src/lib/agent/session.ts). */
export async function tryLockWebSession(id: string, ttlMs = LOCK_TTL_MS): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(agentWebSessions)
    .set({ processingUntil: new Date(now.getTime() + ttlMs) })
    .where(and(
      eq(agentWebSessions.id, id),
      sql`(${agentWebSessions.processingUntil} IS NULL OR ${agentWebSessions.processingUntil} < ${now})`,
    ))
    .returning({ id: agentWebSessions.id });
  return rows.length > 0;
}

export async function unlockWebSession(id: string): Promise<void> {
  await db.update(agentWebSessions).set({ processingUntil: null }).where(eq(agentWebSessions.id, id));
}

export interface WebTranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

/** Text blocks only (no tool_use/tool_result) — the widget renders plain reply bubbles. Returns the latest `limit` messages, oldest-first. */
export async function listWebTranscript(orgId: string, agentSessionId: string, limit = 30): Promise<WebTranscriptEntry[]> {
  const rows = await db
    .select({ role: agentMessages.role, content: agentMessages.content, createdAt: agentMessages.createdAt })
    .from(agentMessages)
    .innerJoin(agentSessions, eq(agentSessions.id, agentMessages.sessionId))
    .where(and(eq(agentSessions.id, agentSessionId), eq(agentSessions.orgId, orgId)))
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit);
  rows.reverse(); // back to chronological order for rendering

  const entries: WebTranscriptEntry[] = [];
  for (const row of rows) {
    const role = row.role === 'user' || row.role === 'assistant' ? row.role : null;
    if (!role) continue;
    const content = row.content as Array<{ type: string; text?: string }>;
    const text = Array.isArray(content)
      ? content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n')
      : '';
    if (!text.trim()) continue;
    entries.push({ role, text, at: row.createdAt.toISOString() });
  }
  return entries;
}
