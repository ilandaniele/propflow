import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { applyLeadQualification, createProspectLead } from '../lead';
import { setSessionLead } from '../session';
import { computeLeadScore, intentTagForScore } from '../scoring';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  fullName: z.string().min(1).max(200).optional().describe('Nombre del prospecto, si lo mencionó'),
  operationType: z.enum(['rent', 'buy']).optional().describe('Qué está buscando: alquilar o comprar'),
  zones: z.array(z.string()).max(5).optional().describe('Zonas o barrios de interés'),
  budgetMax: z.number().min(0).optional().describe('Presupuesto máximo mencionado'),
  bedroomsMin: z.number().int().min(0).optional().describe('Dormitorios mínimos que necesita'),
  moveInDate: z.string().optional().describe('Fecha de mudanza deseada, formato YYYY-MM-DD si la mencionó'),
  timeline: z.enum(['immediate', '1_3_months', '3_6_months', 'flexible']).optional().describe('Urgencia de la búsqueda'),
  pets: z.boolean().optional().describe('true si mencionó que tiene mascotas'),
});

function defaultFullName(channel: string): string {
  return channel === 'whatsapp' ? 'Prospecto WhatsApp' : channel === 'voice' ? 'Prospecto llamada' : 'Prospecto web';
}

export function makeUpdateLeadProfileTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'update_lead_profile',
    description:
      'Guarda datos de calificación que el prospecto fue mencionando (qué busca, zona, presupuesto, dormitorios, urgencia, mascotas). ' +
      'Llamalo cada vez que aparezca un dato nuevo, no hace falta esperar a tener todos. El score y la etiqueta se calculan solos.',
    inputSchema: InputSchema,
    run: async (args) => {
      if (ctx.dryRun) {
        const score = computeLeadScore(args);
        return `[SIMULACIÓN — playground] Se guardaría: ${JSON.stringify(args)}. Score estimado: ${score} (${intentTagForScore(score)}).`;
      }

      let leadId = ctx.leadIdRef.current;
      if (!leadId) {
        const phone = ctx.channel === 'whatsapp' || ctx.channel === 'voice' ? ctx.externalId : null;
        const lead = await createProspectLead({
          orgId: ctx.orgId,
          fullName: args.fullName ?? defaultFullName(ctx.channel),
          phone,
          sourceChannel: ctx.channel,
        });
        leadId = lead.id;
        ctx.leadIdRef.current = leadId;
        await setSessionLead(ctx.sessionId, leadId);
      }

      const updated = await applyLeadQualification(ctx.orgId, leadId, args);
      return `Perfil actualizado. Score: ${updated.score} (${updated.intentTag}).`;
    },
  });
}
