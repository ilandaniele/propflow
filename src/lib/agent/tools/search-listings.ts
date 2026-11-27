import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { searchListings } from '../listings';
import { rememberSessionListings } from '../session-listings';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  operation: z.enum(['rent', 'sale']).optional().describe('Tipo de operación buscada'),
  zone: z.string().optional().describe('Zona o barrio que dijo el usuario; omitilo si no la dijo'),
  bedroomsMin: z.number().int().min(0).optional().describe('Dormitorios mínimos'),
  budgetMax: z.number().min(0).optional().describe('Presupuesto máximo en la moneda local'),
  petsAllowed: z.boolean().optional().describe('true si necesita que se permitan mascotas'),
});

export function makeSearchListingsTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'search_listings',
    description:
      'Busca propiedades reales disponibles (alquiler o venta) que coincidan con los filtros. ' +
      'Devuelve como máximo 8 resultados, solo publicados y disponibles. Nunca inventes resultados fuera de esto.',
    inputSchema: InputSchema,
    run: async (args) => {
      const matches = await searchListings(ctx.orgId, args);
      const hasFilters = Object.values(args).some((v) => v !== undefined);
      const results = matches.length || !hasFilters ? matches : await searchListings(ctx.orgId, {});
      if (results.length === 0) {
        return 'No se encontraron propiedades publicadas. Preguntale al usuario qué zona y presupuesto busca; no derives por esto.';
      }
      // Phase 9: only ids the session has actually seen may later be shown as
      // a card or sent as photos — record them here, before the reply goes out.
      await rememberSessionListings(ctx.orgId, ctx.sessionId, results.map((r) => r.id), 'search');
      ctx.searchedListingsRef.current = true;
      const json = JSON.stringify(results);
      return results === matches ? json : `Estas propiedades disponibles no coinciden con los filtros; ofrecelas y preguntale qué busca: ${json}`;
    },
  });
}
