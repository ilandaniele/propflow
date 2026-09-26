import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { cancelVisit } from '../visits/service';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  visitId: z.string().uuid().describe('Id de la visita a cancelar, de las que devolvió get_my_visits'),
  reason: z.string().max(300).optional().describe('Motivo de la cancelación, si el usuario lo dio'),
});

export function makeCancelVisitTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'cancel_visit',
    description: 'Cancela una visita ya agendada de este lead. Primero usá get_my_visits para ubicar el visitId.',
    inputSchema: InputSchema,
    run: async (args) => {
      // Never trust the model with a lead — cancellations only ever touch ctx.leadIdRef.current's own visits.
      const leadId = ctx.leadIdRef.current;
      if (!leadId) return 'No encontré esa visita.';

      if (ctx.dryRun) {
        return '[SIMULACIÓN — playground] Se cancelaría esa visita.';
      }

      const result = await cancelVisit({ orgId: ctx.orgId, visitId: args.visitId, leadId, reason: args.reason ?? null, actor: 'agent' });
      if (result.ok) return 'Listo, cancelé tu visita.';
      return 'No encontré esa visita.';
    },
  });
}
