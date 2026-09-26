import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { createProspectLead } from '../lead';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  fullName: z.string().min(1).max(200).describe('Nombre del propietario'),
  phone: z.string().min(6).max(20).optional().describe('Teléfono de contacto, si es distinto al de esta conversación'),
  operationType: z.enum(['owner_sell', 'owner_rent']).describe('Si quiere vender o poner en alquiler'),
  zone: z.string().optional().describe('Zona donde está la propiedad'),
  notes: z.string().max(1000).optional().describe('Detalles que mencionó: tipo de propiedad, precio esperado, estado, etc.'),
});

/** Registers a property owner as a SEPARATE lead in the 'supply' pipeline — never merged into the current prospect's demand-side lead. */
export function makeRegisterOwnerLeadTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'register_owner_lead',
    description:
      'Registra a un propietario que quiere vender o poner en alquiler una propiedad (captación). ' +
      'Usalo cuando el que escribe NO está buscando una propiedad para sí mismo, sino ofreciendo la suya.',
    inputSchema: InputSchema,
    run: async (args) => {
      if (ctx.dryRun) {
        return `[SIMULACIÓN — playground] Se registraría un lead de captación: ${JSON.stringify(args)}`;
      }

      const phone = args.phone ?? (ctx.channel === 'whatsapp' || ctx.channel === 'voice' ? ctx.externalId : null);

      await createProspectLead({
        orgId: ctx.orgId,
        fullName: args.fullName,
        phone,
        pipeline: 'supply',
        operationType: args.operationType,
        zones: args.zone ? [args.zone] : [],
        notes: args.notes ?? null,
        sourceChannel: ctx.channel,
      });

      return 'Propietario registrado. Un asesor va a contactarlo para tasar la propiedad.';
    },
  });
}
