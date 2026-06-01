/**
 * Handler: whatsapp.message.received → dispute keyword detection.
 * IC6: if message contains 'disputo|dispute|disputar|quiero disputar' → mark latest sanction as disputed.
 * Locale-aware: checks es/en/pt keywords.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { log } from '@/lib/log';
import type { WhatsAppMessageReceivedPayload } from '../types';

// Dispute keywords per locale (case-insensitive)
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

  // Only process inbound text messages from known tenants
  if (!tenantId || !body) return;
  if (!containsDisputeKeyword(body)) return;

  const adminClient = createAdminClient();

  // Find the most recent 'approved' sanction for this tenant within last 30 days
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const { data: sanction } = await adminClient
    .from('sanctions')
    .select('id, title, tenant_id, org_id')
    .eq('org_id', orgId)
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!sanction) {
    log.info('[dispute-keyword-handler] no eligible sanction found', { orgId });
    return;
  }

  // Mark as disputed
  const { error } = await adminClient
    .from('sanctions')
    .update({
      status: 'disputed',
      dispute_reason: 'Tenant disputed via WhatsApp message',
      disputed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sanction.id);

  if (error) {
    log.error('[dispute-keyword-handler] update failed', { code: error.code, orgId });
    return;
  }

  // Notify admin
  const { data: adminProfile } = await adminClient
    .from('profiles')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (adminProfile) {
    await adminClient.from('notification_inbox').insert({
      org_id: orgId,
      profile_id: adminProfile.id,
      type: 'sanction_disputed',
      title: 'Sanction Disputed via WhatsApp',
      body: `Tenant disputed sanction "${sanction.title}" via WhatsApp message.`,
      related_type: 'sanction',
      related_id: sanction.id,
    });
  }

  log.info('[dispute-keyword-handler] sanction disputed', { orgId, sanctionId: sanction.id });
}
