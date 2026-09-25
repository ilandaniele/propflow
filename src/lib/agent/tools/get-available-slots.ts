import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getListingDetails } from '../listings';
import { getAvailableSlotsForOrg } from '../visits/availability';
import { encodeSlotId } from '../visits/slot-id';
import { formatSlotLabel, pickSlotsForOffer } from '../visits/slots';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  listingId: z.string().uuid().describe('Id de la propiedad a visitar, devuelto por search_listings o get_listing_details'),
  fromDate: z.string().optional().describe('Fecha desde la cual buscar horarios, formato YYYY-MM-DD'),
  partOfDay: z.enum(['morning', 'afternoon', 'evening', 'any']).optional().describe('Preferencia de franja del día, si el usuario la mencionó'),
});

/** Not exposed on LeadRecord (lead.ts is item A/prompt's, not B's) — read directly. */
async function getAssignedProfileId(orgId: string, leadId: string | null): Promise<string | null> {
  if (!leadId) return null;
  const rows = await db
    .select({ assignedProfileId: crmLeads.assignedProfileId })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, orgId)))
    .limit(1);
  return rows[0]?.assignedProfileId ?? null;
}

export function makeGetAvailableSlotsTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'get_available_slots',
    description:
      'Consulta horarios reales disponibles para visitar una propiedad puntual. Nunca inventes horarios: usá siempre esta herramienta antes de ofrecer una fecha u hora. ' +
      'Ofrecé como máximo 3-4 al usuario y confirmá antes de reservar con book_visit.',
    inputSchema: InputSchema,
    run: async (args) => {
      const listing = await getListingDetails(ctx.orgId, args.listingId);
      if (!listing) return 'No se encontró esa propiedad.';

      const from = args.fromDate ? new Date(`${args.fromDate}T00:00:00.000Z`) : undefined;
      const { timezone, slots, loadByProfile } = await getAvailableSlotsForOrg({
        orgId: ctx.orgId,
        listingId: args.listingId,
        from,
      });

      const preferredProfileId = await getAssignedProfileId(ctx.orgId, ctx.leadIdRef.current);
      const picked = pickSlotsForOffer(slots, {
        max: 8,
        preferredProfileId,
        loadByProfile,
        timeZone: timezone,
        partOfDay: args.partOfDay,
      });

      if (picked.length === 0) {
        return (
          'No hay horarios disponibles en los próximos días para esta propiedad. ' +
          'Usá handoff_to_human con motivo visit_scheduling para que un asesor coordine directamente.'
        );
      }

      const lines = picked.map((s) => {
        const visitMinutes = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);
        const slotId = encodeSlotId(
          { profileId: s.profileId, listingId: args.listingId, startsAt: s.startsAt, visitMinutes },
          { orgId: ctx.orgId, sessionId: ctx.sessionId },
        );
        return `${slotId} — ${formatSlotLabel(s.startsAt, timezone)}`;
      });

      lines.push('Usá el id exacto con book_visit; confirmá el día y la hora con el usuario antes de reservar.');
      return lines.join('\n');
    },
  });
}
