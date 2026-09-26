/**
 * Advisor-facing notification for a lead (re)assignment: an in-app
 * notification_inbox row plus a best-effort WhatsApp text to the advisor's
 * own phone. Never throws — routing must not fail because a notification
 * couldn't be sent.
 */

import { db } from '@/lib/db';
import { crmLeads, notificationInbox, profiles } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { log } from '@/lib/log';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import type { AssignmentMethod } from './types';

export interface NotifyAdvisorLeadAssignedArgs {
  orgId: string;
  leadId: string;
  profileId: string;
  method: AssignmentMethod;
}

export async function notifyAdvisorLeadAssigned(a: NotifyAdvisorLeadAssignedArgs): Promise<void> {
  try {
    const leadRows = await db
      .select({ fullName: crmLeads.fullName, pipeline: crmLeads.pipeline, score: crmLeads.score })
      .from(crmLeads)
      .where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.orgId, a.orgId)))
      .limit(1);
    const lead = leadRows[0];

    const profileRows = await db
      .select({ phone: profiles.phone })
      .from(profiles)
      .where(and(eq(profiles.id, a.profileId), eq(profiles.orgId, a.orgId)))
      .limit(1);
    const profile = profileRows[0];

    const firstName = lead?.fullName?.trim().split(/\s+/)[0] ?? 'Prospecto';
    const pipelineLabel = lead?.pipeline === 'supply' ? 'Captación' : 'Demanda';
    const title = 'Nuevo lead asignado';
    const body = `${firstName} · ${pipelineLabel} · score ${lead?.score ?? 0}`;

    await db.insert(notificationInbox).values({
      orgId: a.orgId,
      profileId: a.profileId,
      type: 'lead_assigned',
      title,
      body,
      relatedType: 'crm_lead',
      relatedId: a.leadId,
    });

    if (profile?.phone) {
      const result = await getWhatsAppProvider().sendMessage(a.orgId, {
        to: profile.phone, // PII — never log
        body: `${title}: ${body}`,
      });
      if (!result.success) {
        log.warn('[leads/notify-advisor] whatsapp send failed', { orgId: a.orgId, leadId: a.leadId });
      }
    }
  } catch (err) {
    log.warn('[leads/notify-advisor] failed', { orgId: a.orgId, leadId: a.leadId, err: (err as Error).message });
  }
}
