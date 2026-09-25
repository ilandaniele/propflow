/**
 * agent_web_handoff_codes — WEB-XXXXXX codes that stand in for a booking (or
 * a "continue on WhatsApp" link) until the visitor's WhatsApp message proves
 * they own the phone (Phase 7 decision 6). Never guaranteed until redeemed —
 * see src/lib/agent/web-handoff-redeem.ts (item C).
 */

import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { agentWebHandoffCodes } from '@/lib/db/schema';
import { and, eq, gt, count, sql } from 'drizzle-orm';

export const HANDOFF_CODE_TTL_MS = 30 * 60_000;
export const MAX_CODES_PER_SESSION_PER_DAY = 5;

export type HandoffKind = 'visit' | 'continue';
export type HandoffCodeStatus = 'pending' | 'redeemed' | 'failed' | 'expired' | 'superseded';

export interface HandoffCodeRow {
  id: string;
  orgId: string;
  webSessionId: string;
  code: string;
  kind: HandoffKind;
  leadId: string | null;
  listingId: string | null;
  profileId: string | null;
  startsAt: Date | null;
  visitMinutes: number | null;
  status: HandoffCodeStatus;
  expiresAt: Date;
}

// No 0/O/1/I — unambiguous when read aloud or typed back into WhatsApp.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const MAX_INSERT_RETRIES = 3;

function toRow(row: typeof agentWebHandoffCodes.$inferSelect): HandoffCodeRow {
  return {
    id: row.id,
    orgId: row.orgId,
    webSessionId: row.webSessionId,
    code: row.code,
    kind: row.kind as HandoffKind,
    leadId: row.leadId,
    listingId: row.listingId,
    profileId: row.profileId,
    startsAt: row.startsAt,
    visitMinutes: row.visitMinutes,
    status: row.status as HandoffCodeStatus,
    expiresAt: row.expiresAt,
  };
}

export function generateHandoffCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let suffix = '';
  for (let i = 0; i < CODE_LEN; i++) suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `WEB-${suffix}`;
}

/** /\bWEB-([A-HJ-NP-Z2-9]{6})\b/i, uppercased. Ignores near-misses like "WEB-12" (too short). */
export function extractHandoffCode(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\bWEB-([A-HJ-NP-Z2-9]{6})\b/i);
  return match ? `WEB-${match[1].toUpperCase()}` : null;
}

/** `https://wa.me/<digits>?text=<encoded>` — strips everything but digits from the phone. */
export function buildWhatsAppDeepLink(displayPhoneE164: string, text: string): string {
  const digits = displayPhoneE164.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export interface CreateHandoffCodeArgs {
  orgId: string;
  webSessionId: string;
  kind: HandoffKind;
  leadId: string | null;
  listingId?: string | null;
  profileId?: string | null;
  startsAt?: Date | null;
  visitMinutes?: number | null;
}

/** Null when the session's daily cap (MAX_CODES_PER_SESSION_PER_DAY) is reached. Supersedes any earlier pending code of the same session+kind. Retries up to 3x on a code-collision. */
export async function createHandoffCode(args: CreateHandoffCodeArgs): Promise<HandoffCodeRow | null> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const [{ value: todayCount }] = await db
    .select({ value: count() })
    .from(agentWebHandoffCodes)
    .where(and(
      eq(agentWebHandoffCodes.webSessionId, args.webSessionId),
      gt(agentWebHandoffCodes.createdAt, since),
    ));
  if (todayCount >= MAX_CODES_PER_SESSION_PER_DAY) return null;

  for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx
          .update(agentWebHandoffCodes)
          .set({ status: 'superseded' })
          .where(and(
            eq(agentWebHandoffCodes.webSessionId, args.webSessionId),
            eq(agentWebHandoffCodes.kind, args.kind),
            eq(agentWebHandoffCodes.status, 'pending'),
          ));

        const rows = await tx
          .insert(agentWebHandoffCodes)
          .values({
            orgId: args.orgId,
            webSessionId: args.webSessionId,
            code: generateHandoffCode(),
            kind: args.kind,
            leadId: args.leadId,
            listingId: args.listingId ?? null,
            profileId: args.profileId ?? null,
            startsAt: args.startsAt ?? null,
            visitMinutes: args.visitMinutes ?? null,
            expiresAt: new Date(Date.now() + HANDOFF_CODE_TTL_MS),
          })
          .returning();

        if (!rows[0]) throw new Error('[widget/handoff-codes] createHandoffCode: insert returned no row');
        return toRow(rows[0]);
      });
    } catch (err) {
      // uq_web_handoff_code (org_id, code) collision — retry with a freshly generated code.
      const code = (err as { code?: string })?.code;
      if (code !== '23505' || attempt === MAX_INSERT_RETRIES - 1) throw err;
    }
  }
  throw new Error('[widget/handoff-codes] createHandoffCode: exhausted retries');
}

export async function getLatestPendingCode(orgId: string, webSessionId: string): Promise<HandoffCodeRow | null> {
  const rows = await db
    .select()
    .from(agentWebHandoffCodes)
    .where(and(
      eq(agentWebHandoffCodes.orgId, orgId),
      eq(agentWebHandoffCodes.webSessionId, webSessionId),
      eq(agentWebHandoffCodes.status, 'pending'),
      gt(agentWebHandoffCodes.expiresAt, new Date()),
    ))
    .orderBy(sql`${agentWebHandoffCodes.createdAt} DESC`)
    .limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Redeems a pending, unexpired code for this org+code. A code from another
 * org is simply not found (returns null). A pending-but-expired code is
 * marked 'expired' and 'expired' is returned instead of null, so the caller
 * can tell "no such code" apart from "too late".
 */
export async function claimHandoffCode(
  orgId: string,
  code: string,
  phoneE164: string,
  whatsappSessionId: string,
): Promise<HandoffCodeRow | 'expired' | null> {
  const redeemed = await db
    .update(agentWebHandoffCodes)
    .set({ status: 'redeemed', redeemedPhone: phoneE164, redeemedSessionId: whatsappSessionId, redeemedAt: new Date() })
    .where(and(
      eq(agentWebHandoffCodes.orgId, orgId),
      eq(agentWebHandoffCodes.code, code),
      eq(agentWebHandoffCodes.status, 'pending'),
      gt(agentWebHandoffCodes.expiresAt, new Date()),
    ))
    .returning();
  if (redeemed[0]) return toRow(redeemed[0]);

  const expired = await db
    .update(agentWebHandoffCodes)
    .set({ status: 'expired' })
    .where(and(
      eq(agentWebHandoffCodes.orgId, orgId),
      eq(agentWebHandoffCodes.code, code),
      eq(agentWebHandoffCodes.status, 'pending'),
    ))
    .returning({ id: agentWebHandoffCodes.id });
  if (expired[0]) return 'expired';

  return null;
}

export async function finishHandoffCode(
  id: string,
  o: { status: 'redeemed' | 'failed'; visitId?: string | null; result: string },
): Promise<void> {
  await db
    .update(agentWebHandoffCodes)
    .set({
      status: o.status,
      ...(o.visitId !== undefined ? { visitId: o.visitId } : {}),
      result: o.result,
    })
    .where(eq(agentWebHandoffCodes.id, id));
}
