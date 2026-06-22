/**
 * Handler: whatsapp.message.received → dispute keyword detection.
 * IC6: if message contains 'disputo|dispute|disputar|quiero disputar' → mark latest sanction as disputed.
 * Locale-aware: checks es/en/pt keywords.
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { sanctions, profiles, notificationInbox } from '@/lib/db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { log } from '@/lib/log';
import type { WhatsAppMessageReceivedPayload } from '../types';

const DISPUTE_KEYWORDS_ES = ['disputo', 'disputar', 'quiero disputar', 'disputa'];
const DISPUTE_KEYWORDS_EN = ['dispute', 'i want to dispute', 'i dispute', 'contest'];
const DISPUTE_KEYWORDS_PT = ['contestar', 'disputa', 'quero contestar', 'disputo'];

const ALL_KEYWORDS = [
  ...DISPUTE_KEYWORDS_ES,
  ...DISPUTE_KEYWORDS_EN,
  ...DISPUTE_KEYWORDS_PT,
];

function containsDisputeKeyword(body: string): boolean {
  const lower = body.toLowerCase();
  return ALL_KEYWORDS.some((kw) => lower.includes(kw));
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function handleWhatsAppDisputeKeyword(
  payload: WhatsAppMessageReceivedPayload
): Promise<void> {
  const { orgId, tenantId, body } = payload;

  if (!tenantId || !body) return;
  if (!containsDisputeKeyword(body)) return;

  // Find most recent 'approved' sanction for this tenant within last 30 days
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

  const sanctionRows = await db
    .select({ id: sanctions.id, title: sanctions.title, tenantId: sanctions.tenantId, orgId: sanctions.orgId })
    .from(sanctions)
    .where(and(
      eq(sanctions.orgId, orgId),
      eq(sanctions.tenantId, tenantId),
      eq(sanctions.status, 'approved'),
      gte(sanctions.createdAt, thirtyDaysAgo),
    ))
    .orderBy(desc(sanctions.createdAt))
    .limit(1);

  const sanction = sanctionRows[0];
  if (!sanction) {
    log.info('[dispute-keyword-handler] no eligible sanction found', { orgId });
    return;
  }

  // Mark as disputed
  const updated = await db
    .update(sanctions)
    .set({
      status:        'disputed',
      disputeReason: 'Tenant disputed via WhatsApp message',
      disputedAt:    new Date(),
      updatedAt:     new Date(),
    })
    .where(and(eq(sanctions.id, sanction.id), eq(sanctions.orgId, orgId)))
    .returning({ id: sanctions.id });

  if (updated.length === 0) {
    log.error('[dispute-keyword-handler] update failed — row not found', { orgId, sanctionId: sanction.id });
    return;
  }

  // Notify admin
  const adminRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .limit(1);

  const adminProfile = adminRows[0];
  if (adminProfile) {
    await db.insert(notificationInbox).values({
      orgId,
      profileId:   adminProfile.id,
      type:        'sanction_disputed',
      title:       'Sanction Disputed via WhatsApp',
      body:        `Tenant disputed sanction "${sanction.title}" via WhatsApp message.`,
      relatedType: 'sanction',
      relatedId:   sanction.id,
    });
  }

  log.info('[dispute-keyword-handler] sanction disputed', { orgId, sanctionId: sanction.id });
}
