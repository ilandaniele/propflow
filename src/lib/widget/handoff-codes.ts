/**
 * agent_web_handoff_codes — WEB-XXXXXX codes that stand in for a booking (or
 * a "continue on WhatsApp" link) until the visitor's WhatsApp message proves
 * they own the phone (Phase 7 decision 6). Never guaranteed until redeemed —
 * see src/lib/agent/web-handoff-redeem.ts (item C).
 */

import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { agentWebHandoffCodes } from '@/lib/db/schema';
import { and, eq, gt, count, sql, or } from 'drizzle-orm';

export const HANDOFF_CODE_TTL_MS = 30 * 60_000;
export const MAX_CODES_PER_SESSION_PER_DAY = 5;
/** Phase 8: voice codes ('VOZ-XXXXXX') get a longer TTL (2h) than web codes (30min) — a caller may take a while to open WhatsApp and confirm. */
export const VOICE_CODE_TTL_MS = 2 * 3600_000;
/** Phase 8: the daily cap for voice codes is per target_phone, not per session (voice has no web_session_id). */
export const MAX_VOICE_CODES_PER_PHONE_PER_DAY = 5;

export type HandoffKind = 'visit' | 'continue';
export type HandoffCodeStatus = 'pending' | 'redeemed' | 'failed' | 'expired' | 'superseded';
export type HandoffSource = 'web' | 'voice';

export interface HandoffCodeRow {
  id: string;
  orgId: string;
  webSessionId: string | null;
  code: string;
  kind: HandoffKind;
  leadId: string | null;
  listingId: string | null;
  profileId: string | null;
  startsAt: Date | null;
  visitMinutes: number | null;
  status: HandoffCodeStatus;
  expiresAt: Date;
  source: HandoffSource;
  callId: string | null;
  targetPhone: string | null;
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
    source: (row.source as HandoffSource) ?? 'web',
    callId: row.callId,
    targetPhone: row.targetPhone,
  };
}

export function generateHandoffCode(source: HandoffSource = 'web'): string {
  const bytes = randomBytes(CODE_LEN);
  let suffix = '';
  for (let i = 0; i < CODE_LEN; i++) suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${source === 'voice' ? 'VOZ' : 'WEB'}-${suffix}`;
}

/** /\b(WEB|VOZ)-([A-HJ-NP-Z2-9]{6})\b/i, uppercased. Ignores near-misses like "WEB-12" (too short). */
export function extractHandoffCode(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\b(WEB|VOZ)-([A-HJ-NP-Z2-9]{6})\b/i);
  return match ? `${match[1].toUpperCase()}-${match[2].toUpperCase()}` : null;
}

/** `https://wa.me/<digits>?text=<encoded>` — strips everything but digits from the phone. */
export function buildWhatsAppDeepLink(displayPhoneE164: string, text: string): string {
  const digits = displayPhoneE164.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export interface CreateHandoffCodeArgs {
  orgId: string;
  kind: HandoffKind;
  leadId: string | null;
  listingId?: string | null;
  profileId?: string | null;
  startsAt?: Date | null;
  visitMinutes?: number | null;
  /** Phase 8: defaults to 'web'. 'voice' requires callId+targetPhone and omits webSessionId. */
  source?: HandoffSource;
  /** Required when source === 'web'. */
  webSessionId?: string;
  /** Required when source === 'voice'. */
  callId?: string;
  /** Required when source === 'voice' — the only phone this code can redeem from (blueprint §0.7). */
  targetPhone?: string;
  /** Defaults to HANDOFF_CODE_TTL_MS (web) / VOICE_CODE_TTL_MS (voice, if not overridden). */
  ttlMs?: number;
}

/**
 * Null when the daily cap is reached — MAX_CODES_PER_SESSION_PER_DAY per
 * web_session_id for source='web', MAX_VOICE_CODES_PER_PHONE_PER_DAY per
 * target_phone for source='voice'. Supersedes any earlier pending code of
 * the same session/phone+kind. Retries up to 3x on a code-collision.
 */
export async function createHandoffCode(args: CreateHandoffCodeArgs): Promise<HandoffCodeRow | null> {
  const source: HandoffSource = args.source ?? 'web';
  if (source === 'web' && !args.webSessionId) {
    throw new Error('[widget/handoff-codes] createHandoffCode: webSessionId is required for source="web"');
  }
  if (source === 'voice' && (!args.callId || !args.targetPhone)) {
    throw new Error('[widget/handoff-codes] createHandoffCode: callId and targetPhone are required for source="voice"');
  }

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const dailyCapCondition =
    source === 'web'
      ? eq(agentWebHandoffCodes.webSessionId, args.webSessionId!)
      : eq(agentWebHandoffCodes.targetPhone, args.targetPhone!);
  const dailyCap = source === 'web' ? MAX_CODES_PER_SESSION_PER_DAY : MAX_VOICE_CODES_PER_PHONE_PER_DAY;

  const [{ value: todayCount }] = await db
    .select({ value: count() })
    .from(agentWebHandoffCodes)
    .where(and(dailyCapCondition, gt(agentWebHandoffCodes.createdAt, since)));
  if (todayCount >= dailyCap) return null;

  const supersedeCondition =
    source === 'web'
      ? and(eq(agentWebHandoffCodes.webSessionId, args.webSessionId!), eq(agentWebHandoffCodes.kind, args.kind), eq(agentWebHandoffCodes.status, 'pending'))
      : and(eq(agentWebHandoffCodes.targetPhone, args.targetPhone!), eq(agentWebHandoffCodes.kind, args.kind), eq(agentWebHandoffCodes.status, 'pending'));

  const ttlMs = args.ttlMs ?? (source === 'voice' ? VOICE_CODE_TTL_MS : HANDOFF_CODE_TTL_MS);

  for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.update(agentWebHandoffCodes).set({ status: 'superseded' }).where(supersedeCondition);

        const rows = await tx
          .insert(agentWebHandoffCodes)
          .values({
            orgId: args.orgId,
            webSessionId: source === 'web' ? args.webSessionId! : null,
            code: generateHandoffCode(source),
            kind: args.kind,
            leadId: args.leadId,
            listingId: args.listingId ?? null,
            profileId: args.profileId ?? null,
            startsAt: args.startsAt ?? null,
            visitMinutes: args.visitMinutes ?? null,
            expiresAt: new Date(Date.now() + ttlMs),
            source,
            callId: source === 'voice' ? args.callId! : null,
            targetPhone: source === 'voice' ? args.targetPhone! : null,
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

/** Phase 8: resolves the bare "Confirmar visita" text (no code typed) to the phone's latest pending, unexpired voice code. */
export async function getLatestPendingVoiceCodeForPhone(orgId: string, phoneE164: string): Promise<HandoffCodeRow | null> {
  const rows = await db
    .select()
    .from(agentWebHandoffCodes)
    .where(and(
      eq(agentWebHandoffCodes.orgId, orgId),
      eq(agentWebHandoffCodes.source, 'voice'),
      eq(agentWebHandoffCodes.targetPhone, phoneE164),
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
      // Phase 8: a voice code only redeems from the phone it was sent to —
      // neutralises a spoofed caller ID (blueprint §0.7). Web codes are
      // unaffected (no target_phone check for them).
      or(eq(agentWebHandoffCodes.source, 'web'), eq(agentWebHandoffCodes.targetPhone, phoneE164)),
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
