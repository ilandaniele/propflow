import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getListingDetails } from '../listings';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  listingId: z.string().uuid().describe('Id de la propiedad, devuelto por search_listings'),
});

export function makeGetListingDetailsTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'get_listing_details',
    description: 'Trae el detalle completo de una propiedad por su id. Usalo solo con ids que hayan salido de search_listings.',
    inputSchema: InputSchema,
    run: async (args) => {
      const listing = await getListingDetails(ctx.orgId, args.listingId);
      if (!listing) return 'No se encontró esa propiedad, o ya no está publicada.';
      return JSON.stringify(listing);
    },
  });
}
