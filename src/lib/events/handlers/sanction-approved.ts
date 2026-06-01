/**
 * Handler: sanction.approved → create charges row for monetary sanctions.
 * IC6: exactly one charge per approval, linked via sanctions.linked_charge_id (UNIQUE).
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { log } from '@/lib/log';
import type { SanctionApprovedPayload } from '../types';

export async function handleSanctionApproved(
  payload: SanctionApprovedPayload
): Promise<void> {
  // This handler is a safety net — the primary charge creation happens in
  // the approveSanction Server Action. This handler handles fan-out (notifications, etc.)
  const { orgId, sanctionId, tenantId, chargeId } = payload;

  if (!chargeId) return; // warning sanction — no charge

  // Notify tenant (in-app)
  const adminClient = createAdminClient();

  const { data: tenant } = await adminClient
    .from('tenants')
    .select('profile_id, full_name')
    .eq('id', tenantId)
    .single();

  if (tenant?.profile_id) {
    const { data: sanction } = await adminClient
      .from('sanctions')
      .select('title, amount')
      .eq('id', sanctionId)
      .single();

    if (sanction) {
      await adminClient.from('notification_inbox').insert({
        org_id: orgId,
        profile_id: tenant.profile_id,
        type: 'sanction_approved',
        title: 'Sanction Applied',
        body: `A sanction of $${Number(sanction.amount).toLocaleString()} has been applied: ${sanction.title}`,
        related_type: 'sanction',
        related_id: sanctionId,
      });
    }
  }

  log.info('[sanction-approved-handler] notification sent', { orgId, sanctionId });
}
