import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getOrCreateAgentConfig } from '../config';
import { getListingDetails } from '../listings';
import { getAvailableSlotsForOrg, isSlotStillAvailable } from '../visits/availability';
import { bookVisit } from '../visits/service';
import { decodeSlotId, encodeSlotId, type SlotClaim } from '../visits/slot-id';
import { formatSlotLabel, pickSlotsForOffer } from '../visits/slots';
import { MAX_ACTIVE_VISITS_PER_PHONE } from '../visits/types';
import { ensureLead } from './ensure-lead';
import { createHandoffCode, VOICE_CODE_TTL_MS } from '@/lib/widget/handoff-codes';
import { enqueueJob } from '../jobs';
import { recordAgentEvent } from '../events';
import { VOICE_JOB_KINDS } from '../voice/types';
import type { AgentToolContext } from './context';

/** Blueprint §0.6: only a caller-id-shaped externalId (never 'call:<vapiCallId>') becomes a phone. */
const E164_RE = /^\+\d{7,15}$/;

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

      // Phase 7 web branch (decision 6): never writes property_visits directly —
      // issues a WEB-XXXXXX handoff code instead. The slot is NOT held; it's
      // only booked once the visitor's own WhatsApp message redeems the code
      // (web-handoff-redeem.ts), which rechecks availability via bookVisit's
      // own exclusion constraint.
      if (ctx.channel === 'web' && ctx.webSessionId) {
        const leadId = await ensureLead(ctx, args.fullName);
        const code = await createHandoffCode({
          orgId: ctx.orgId,
          webSessionId: ctx.webSessionId,
          kind: 'visit',
          leadId,
          listingId: claim.listingId,
          profileId: claim.profileId,
          startsAt: claim.startsAt,
          visitMinutes: claim.visitMinutes,
        });
        if (!code) return 'Ya generaste varios pedidos hoy; seguí por WhatsApp.';
        return `Pedido listo para ${label}. Para confirmarlo tocá el botón y enviá el mensaje de WhatsApp (vence en 30 min). El horario no queda reservado hasta entonces.`;
      }

      // Phase 8 voice branch (decision 7): never writes property_visits directly
      // and never holds the slot — issues a VOZ-XXXXXX WhatsApp confirmation
      // code (Phase 7's handoff codes, generalised) and enqueues the send job.
      // Redemption happens through web-handoff-redeem.ts, from target_phone only.
      if (ctx.channel === 'voice' && ctx.voiceCallId) {
        const targetPhone = E164_RE.test(ctx.externalId) ? ctx.externalId : null;
        if (!targetPhone || !config.channelsEnabled.whatsapp) {
          await recordAgentEvent({ orgId: ctx.orgId, sessionId: ctx.sessionId, kind: 'handoff', data: { reason: 'voice_booking' } });
          return 'Un asesor te va a confirmar por WhatsApp.';
        }

        const leadId = await ensureLead(ctx, args.fullName);
        const code = await createHandoffCode({
          orgId: ctx.orgId,
          source: 'voice',
          kind: 'visit',
          callId: ctx.voiceCallId,
          targetPhone,
          ttlMs: VOICE_CODE_TTL_MS,
          leadId,
          listingId: claim.listingId,
          profileId: claim.profileId,
          startsAt: claim.startsAt,
          visitMinutes: claim.visitMinutes,
        });
        if (!code) {
          await recordAgentEvent({ orgId: ctx.orgId, sessionId: ctx.sessionId, kind: 'handoff', data: { reason: 'voice_booking_cap' } });
          return 'Ya generaste varios pedidos hoy; un asesor te puede ayudar directamente.';
        }

        await enqueueJob({ orgId: ctx.orgId, kind: VOICE_JOB_KINDS.visitConfirmationMessage, payload: { codeId: code.id } });
        return `Te envié un WhatsApp para confirmar la visita del ${label}. El horario queda reservado recién cuando lo confirmes.`;
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

      // The slot id can be up to 24h old (its TTL) — recheck it's still
      // actually offered before writing, instead of relying solely on the
      // DB's exclusion constraint to catch a stale claim.
      const stillAvailable = await isSlotStillAvailable({
        orgId: ctx.orgId,
        profileId: claim.profileId,
        listingId: claim.listingId,
        startsAt: claim.startsAt,
      });
      if (!stillAvailable) {
        const alt = await alternativesText(ctx, claim, config.timezone);
        return `Ese horario ya no está disponible. ${alt}`;
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
