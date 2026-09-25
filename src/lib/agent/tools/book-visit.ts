import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getOrCreateAgentConfig } from '../config';
import { getListingDetails } from '../listings';
import { getAvailableSlotsForOrg } from '../visits/availability';
import { bookVisit } from '../visits/service';
import { decodeSlotId, encodeSlotId, type SlotClaim } from '../visits/slot-id';
import { formatSlotLabel, pickSlotsForOffer } from '../visits/slots';
import { MAX_ACTIVE_VISITS_PER_PHONE } from '../visits/types';
import { ensureLead } from './ensure-lead';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  slotId: z.string().max(120).describe('El id exacto de un horario devuelto por get_available_slots en esta misma conversación'),
  fullName: z.string().min(1).max(200).optional().describe('Nombre del prospecto, si lo mencionó'),
});

/** Up to 3 fresh slots for the same listing/advisor, offered when the chosen one was just taken. */
async function alternativesText(ctx: AgentToolContext, claim: SlotClaim, timezone: string): Promise<string> {
  const { slots, loadByProfile } = await getAvailableSlotsForOrg({ orgId: ctx.orgId, listingId: claim.listingId });
  const picked = pickSlotsForOffer(slots, { max: 3, preferredProfileId: claim.profileId, loadByProfile, timeZone: timezone });
  if (picked.length === 0) return 'No quedan otros horarios por ahora; probá de nuevo más tarde con get_available_slots.';

  const lines = picked.map((s) => {
    const visitMinutes = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);
    const slotId = encodeSlotId(
      { profileId: s.profileId, listingId: claim.listingId, startsAt: s.startsAt, visitMinutes },
      { orgId: ctx.orgId, sessionId: ctx.sessionId },
    );
    return `${slotId} — ${formatSlotLabel(s.startsAt, timezone)}`;
  });
  return `Estas son otras opciones:\n${lines.join('\n')}`;
}

export function makeBookVisitTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'book_visit',
    description:
      'Reserva una visita usando el slotId exacto que te dio get_available_slots en esta conversación. ' +
      'Confirmá el día y la hora con el usuario antes de llamarla. Solo reserva de verdad por WhatsApp; en otros canales avisá que hay que coordinar por WhatsApp.',
    inputSchema: InputSchema,
    run: async (args) => {
      const claim = decodeSlotId(args.slotId, { orgId: ctx.orgId, sessionId: ctx.sessionId });
      if (!claim) return 'Ese horario no es válido, puede haber expirado. Pedí horarios nuevos con get_available_slots.';

      const config = await getOrCreateAgentConfig(ctx.orgId);
      const label = formatSlotLabel(claim.startsAt, config.timezone);

      if (ctx.dryRun) {
        return `[SIMULACIÓN — playground] Se reservaría una visita para el ${label}.`;
      }

      if (ctx.channel !== 'whatsapp') {
        return `Para confirmar la visita del ${label} coordinemos por WhatsApp — pedile al usuario que te escriba por ahí para reservarla.`;
      }

      const leadId = await ensureLead(ctx, args.fullName);

      let listingTitle: string | null = null;
      if (claim.listingId) {
        const listing = await getListingDetails(ctx.orgId, claim.listingId);
        listingTitle = listing?.title ?? null;
      }

      const result = await bookVisit({
        orgId: ctx.orgId,
        leadId,
        listingId: claim.listingId,
        profileId: claim.profileId,
        startsAt: claim.startsAt,
        visitMinutes: claim.visitMinutes,
        contactPhone: ctx.externalId,
        createdBy: 'agent',
        sourceChannel: ctx.channel,
        sessionId: ctx.sessionId,
        requirePublishedListing: true,
        enforcePhoneCap: true,
      });

      if (result.ok) {
        const titlePart = listingTitle ? ` para "${listingTitle}"` : '';
        return `¡Listo! Reservé la visita${titlePart} para el ${label}. En breve te confirmamos por WhatsApp.`;
      }

      switch (result.reason) {
        case 'slot_taken': {
          const alt = await alternativesText(ctx, claim, config.timezone);
          return `Ese horario se acaba de ocupar. ${alt}`;
        }
        case 'cap_reached':
          return `Ya tenés ${MAX_ACTIVE_VISITS_PER_PHONE} visitas agendadas. Usá get_my_visits para reprogramar o cancelar alguna antes de reservar otra.`;
        case 'listing_unavailable':
          return 'Esa propiedad ya no está disponible para agendar visitas.';
        case 'advisor_invalid':
          return 'Ese horario ya no está disponible. Pedí horarios nuevos con get_available_slots.';
        case 'lead_not_found':
          return 'No pude ubicar tus datos. Contame de nuevo qué estás buscando.';
        default:
          return 'No pude reservar la visita ahora. Pedí horarios nuevos con get_available_slots.';
      }
    },
  });
}
