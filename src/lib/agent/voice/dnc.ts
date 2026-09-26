/**
 * voice_do_not_call — the org-scoped DNC list checked by the outbound
 * compliance gate (item C) and edited from /dashboard/agent/settings (item D).
 */

import { db } from '@/lib/db';
import { voiceDoNotCall } from '@/lib/db/schema';
import { and, count, eq, ilike, or, sql } from 'drizzle-orm';
import { toE164 } from '@/lib/whatsapp/phone';

const PAGE_SIZE = 50;

export async function isOnDoNotCallList(orgId: string, phoneE164: string): Promise<boolean> {
  const rows = await db
    .select({ phoneE164: voiceDoNotCall.phoneE164 })
    .from(voiceDoNotCall)
    .where(and(eq(voiceDoNotCall.orgId, orgId), eq(voiceDoNotCall.phoneE164, toE164(phoneE164))))
    .limit(1);
  return rows.length > 0;
}

export interface AddDoNotCallArgs {
  orgId: string;
  phoneE164: string;
  source: 'staff' | 'caller_request';
  reason?: string | null;
  profileId?: string | null;
}

export async function addDoNotCall(a: AddDoNotCallArgs): Promise<void> {
  await db
    .insert(voiceDoNotCall)
    .values({
      orgId: a.orgId,
      phoneE164: toE164(a.phoneE164),
      source: a.source,
      reason: a.reason ?? null,
      addedByProfileId: a.profileId ?? null,
    })
    .onConflictDoNothing({ target: [voiceDoNotCall.orgId, voiceDoNotCall.phoneE164] });
}

export type RemoveDoNotCallResult = 'removed' | 'not_found' | 'protected';

/** 'protected': a caller_request entry can't be removed from the settings UI — only the caller themselves (via opt-in on a later call, out of scope here) can undo it. */
export async function removeDoNotCall(orgId: string, phoneE164: string): Promise<RemoveDoNotCallResult> {
  const normalized = toE164(phoneE164);
  const rows = await db
    .select({ source: voiceDoNotCall.source })
    .from(voiceDoNotCall)
    .where(and(eq(voiceDoNotCall.orgId, orgId), eq(voiceDoNotCall.phoneE164, normalized)))
    .limit(1);
  const row = rows[0];
  if (!row) return 'not_found';
  if (row.source === 'caller_request') return 'protected';

  await db.delete(voiceDoNotCall).where(and(eq(voiceDoNotCall.orgId, orgId), eq(voiceDoNotCall.phoneE164, normalized)));
  return 'removed';
}

export interface ListDoNotCallOptions {
  q?: string;
  page?: number;
}

export interface DoNotCallEntry {
  phoneE164: string;
  source: 'staff' | 'caller_request';
  reason: string | null;
  createdAt: Date;
}

/** 50/page; `total` is count(*) over ALL matching rows, not the page. */
export async function listDoNotCall(orgId: string, o: ListDoNotCallOptions = {}): Promise<{ items: DoNotCallEntry[]; total: number }> {
  const page = Math.max(1, o.page ?? 1);
  const qFilter = o.q?.trim()
    ? or(ilike(voiceDoNotCall.phoneE164, `%${o.q.trim()}%`), ilike(voiceDoNotCall.reason, `%${o.q.trim()}%`))
    : undefined;
  const where = qFilter ? and(eq(voiceDoNotCall.orgId, orgId), qFilter) : eq(voiceDoNotCall.orgId, orgId);

  const [{ value: total }] = await db.select({ value: count() }).from(voiceDoNotCall).where(where);

  const rows = await db
    .select()
    .from(voiceDoNotCall)
    .where(where)
    .orderBy(sql`${voiceDoNotCall.createdAt} DESC`)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    items: rows.map((r) => ({
      phoneE164: r.phoneE164,
      source: r.source as DoNotCallEntry['source'],
      reason: r.reason,
      createdAt: r.createdAt,
    })),
    total,
  };
}
