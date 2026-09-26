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

      // Only 'scheduled' is actually confirmable — check this before dryRun
      // too, so the simulation reply reflects what would really happen
      // instead of always claiming success.
      if (visit.status === 'confirmed') return 'Esa visita ya está confirmada.';
      if (visit.status !== 'scheduled') {
        return 'Esa visita ya no está activa, así que no se puede confirmar.';
      }

      if (ctx.dryRun) {
        return '[SIMULACIÓN — playground] Se confirmaría esa visita.';
      }

      const updated = await confirmVisit(ctx.orgId, args.visitId);
      // confirmVisit is idempotent and only flips scheduled -> confirmed; say
      // "confirmed" only when it actually made that change.
      if (!updated || updated.status !== 'confirmed') return 'No pude confirmar esa visita.';
      return 'Listo, confirmé tu visita.';
    },
  });
}
