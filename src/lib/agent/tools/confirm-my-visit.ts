import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { confirmVisit, getVisit } from '../visits/service';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  visitId: z.string().uuid().describe('Id de la visita a confirmar, de las que devolvió get_my_visits'),
});

export function makeConfirmMyVisitTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'confirm_my_visit',
    description: 'Confirma una visita ya agendada de este lead (incluye las reservadas por voz vía código de WhatsApp). Primero usá get_my_visits para ubicar el visitId.',
    inputSchema: InputSchema,
    run: async (args) => {
      // Never trust the model with a lead — only this lead's own visit can be confirmed.
      const leadId = ctx.leadIdRef.current;
      const visit = leadId ? await getVisit(ctx.orgId, args.visitId) : null;
      if (!visit || visit.leadId !== leadId) return 'No encontré esa visita.';

      if (ctx.dryRun) {
        return '[SIMULACIÓN — playground] Se confirmaría esa visita.';
      }

      await confirmVisit(ctx.orgId, args.visitId);
      return 'Listo, confirmé tu visita.';
    },
  });
}
