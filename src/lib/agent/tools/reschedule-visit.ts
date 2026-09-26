import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getOrCreateAgentConfig } from '../config';
import { isSlotStillAvailable } from '../visits/availability';
import { rescheduleVisit } from '../visits/service';
import { decodeSlotId } from '../visits/slot-id';
import { formatSlotLabel } from '../visits/slots';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  visitId: z.string().uuid().describe('Id de la visita a reprogramar, de las que devolvió get_my_visits'),
  slotId: z.string().max(120).describe('El id exacto de un horario nuevo, devuelto por get_available_slots en esta misma conversación'),
});

export function makeRescheduleVisitTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'reschedule_visit',
    description:
      'Reprograma una visita ya agendada de este lead a un horario nuevo. Primero usá get_my_visits para ubicar el visitId y get_available_slots para el slotId nuevo. ' +
      'Solo reprograma de verdad por WhatsApp; en otros canales avisá que hay que coordinar por WhatsApp.',
    inputSchema: InputSchema,
    run: async (args) => {
      const claim = decodeSlotId(args.slotId, { orgId: ctx.orgId, sessionId: ctx.sessionId });
      if (!claim) return 'Ese horario no es válido, puede haber expirado. Pedí horarios nuevos con get_available_slots.';

      // Never trust the model with a lead — reschedules only ever touch ctx.leadIdRef.current's own visits.
      const leadId = ctx.leadIdRef.current;
      if (!leadId) return 'No encontré esa visita.';

      const config = await getOrCreateAgentConfig(ctx.orgId);
      const label = formatSlotLabel(claim.startsAt, config.timezone);

      if (ctx.dryRun) {
        return `[SIMULACIÓN — playground] Se reprogramaría la visita para el ${label}.`;
      }

      if (ctx.channel !== 'whatsapp') {
        return `Para reprogramar la visita al ${label} coordinemos por WhatsApp — pedile al usuario que te escriba por ahí.`;
      }

      // The slot id can be up to 24h old (its TTL) — recheck it's still
      // actually offered before writing, instead of relying solely on the
      // DB's exclusion constraint to catch a stale claim.
      const stillAvailable = await isSlotStillAvailable({
        orgId: ctx.orgId,
        profileId: claim.profileId,
        listingId: claim.listingId,
        startsAt: claim.startsAt,
      });
      if (!stillAvailable) return 'Ese horario se acaba de ocupar; pedí horarios nuevos con get_available_slots.';

      const result = await rescheduleVisit({
        orgId: ctx.orgId,
        visitId: args.visitId,
        leadId,
        newStartsAt: claim.startsAt,
        visitMinutes: claim.visitMinutes,
        profileId: claim.profileId,
        actor: 'agent',
        sessionId: ctx.sessionId,
      });

      if (result.ok) return `Listo, reprogramé tu visita para el ${label}.`;
      if (result.reason === 'not_found' || result.reason === 'not_active') return 'No encontré esa visita.';
      if (result.reason === 'slot_taken') return 'Ese horario se acaba de ocupar; pedí horarios nuevos con get_available_slots.';
      return 'No pude reprogramar la visita ahora. Pedí horarios nuevos con get_available_slots.';
    },
  });
}
