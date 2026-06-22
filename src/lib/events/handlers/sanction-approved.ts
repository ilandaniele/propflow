/**
 * Handler: sanction.approved → create charges row for monetary sanctions.
 * IC6: exactly one charge per approval, linked via sanctions.linked_charge_id (UNIQUE).
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { tenants, sanctions, notificationInbox } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { log } from '@/lib/log';
import type { SanctionApprovedPayload } from '../types';

export async function handleSanctionApproved(
  payload: SanctionApprovedPayload
): Promise<void> {
  const { orgId, sanctionId, tenantId, chargeId } = payload;

  if (!chargeId) return; // warning sanction — no charge

  // Get profile_id from tenant row
  const tenantRows = await db
    .select({ profileId: tenants.profileId, fullName: tenants.fullName })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, orgId)))
    .limit(1);

  const tenant = tenantRows[0];
  if (!tenant?.profileId) return;

  // Get sanction info for notification body
  const sanctionRows = await db
    .select({ title: sanctions.title, amount: sanctions.amount })
    .from(sanctions)
    .where(and(eq(sanctions.id, sanctionId), eq(sanctions.orgId, orgId)))
    .limit(1);

  const sanction = sanctionRows[0];
  if (!sanction) return;

  await db.insert(notificationInbox).values({
    orgId,
    profileId: tenant.profileId,
    type:        'sanction_approved',
    title:       'Sanction Applied',
    body:        `A sanction of $${Number(sanction.amount ?? 0).toLocaleString()} has been applied: ${sanction.title}`,
    relatedType: 'sanction',
    relatedId:   sanctionId,
  });

  log.info('[sanction-approved-handler] notification sent', { orgId, sanctionId });
}
