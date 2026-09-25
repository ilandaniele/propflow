import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getListingDetails, type ListingDetail } from '../listings';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  listingId: z.string().uuid().describe('Id de la propiedad a mostrar, devuelto por search_listings'),
});

function formatCard(listing: ListingDetail): string {
  const price = listing.price ? `${listing.currency} ${listing.price}` : 'a consultar';
  const bits = [
    listing.title ?? 'Propiedad',
    `Precio: ${price}`,
    listing.zone ? `Zona: ${listing.zone}` : null,
    listing.bedrooms != null ? `Dormitorios: ${listing.bedrooms}` : null,
    listing.areaM2 ? `Área: ${listing.areaM2} m²` : null,
    listing.petsAllowed != null ? `Mascotas: ${listing.petsAllowed ? 'sí' : 'no'}` : null,
  ].filter(Boolean);
  return bits.join('\n');
}

export function makeSendListingCardTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'send_listing_card',
    description:
      'Devuelve una ficha lista para mostrar al usuario (título, precio, zona, dormitorios, área). ' +
      'Usalo cuando quieras presentar una propiedad puntual, no para listar varias — para eso usá search_listings.',
    inputSchema: InputSchema,
    run: async (args) => {
      const listing = await getListingDetails(ctx.orgId, args.listingId);
      if (!listing) return 'No se encontró esa propiedad, o ya no está publicada.';
      return formatCard(listing);
    },
  });
}
