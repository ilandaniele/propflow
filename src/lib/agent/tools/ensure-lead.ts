import { attributionToSource, createProspectLead } from '../lead';
import { setSessionLead } from '../session';
import type { AgentToolContext } from './context';

function defaultFullName(channel: string): string {
  return channel === 'whatsapp' ? 'Prospecto WhatsApp' : channel === 'voice' ? 'Prospecto llamada' : 'Prospecto web';
}

/**
 * Idempotent lead-creation shared by every tool that needs a leadId before it
 * can write (update_lead_profile, book_visit, ...). Returns ctx.leadIdRef.current
 * unchanged when it's already set. Otherwise creates a lead — phone =
 * ctx.externalId on whatsapp/voice, null on web — stores it on the session and
 * mutates leadIdRef so later tools in the same turn see it too.
 */
export async function ensureLead(ctx: AgentToolContext, fullName?: string): Promise<string> {
  if (ctx.leadIdRef.current) return ctx.leadIdRef.current;

  const phone = ctx.channel === 'whatsapp' || ctx.channel === 'voice' ? ctx.externalId : null;
  const { sourceRef, sourceMeta } = attributionToSource(ctx.attribution);
  const lead = await createProspectLead({
    orgId: ctx.orgId,
    fullName: fullName ?? defaultFullName(ctx.channel),
    phone,
    sourceChannel: ctx.channel,
    sourceRef,
    sourceMeta,
  });

  ctx.leadIdRef.current = lead.id;
  await setSessionLead(ctx.sessionId, lead.id);
  return lead.id;
}
