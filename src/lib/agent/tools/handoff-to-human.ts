import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { setSessionMode } from '../session';
import { recordAgentEvent } from '../events';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  reason: z.enum(['complaint', 'legal', 'wants_human', 'out_of_scope', 'visit_scheduling']).describe('Motivo del traspaso'),
  summary: z.string().max(1000).describe('Resumen breve de la conversación para el asesor humano, en español'),
});

export function makeHandoffToHumanTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'handoff_to_human',
    description:
      'Deriva la conversación a un asesor humano y pausa las respuestas automáticas. ' +
      'Usalo ante quejas serias, reclamos legales, pedidos explícitos de hablar con una persona, o coordinación de visitas.',
    inputSchema: InputSchema,
    run: async (args) => {
      if (ctx.dryRun) {
        return `[SIMULACIÓN — playground] Se derivaría a un humano (motivo: ${args.reason}). Resumen: ${args.summary}`;
      }
      await setSessionMode(ctx.sessionId, 'human', args.summary, 'tool');
      await recordAgentEvent({
        orgId: ctx.orgId,
        sessionId: ctx.sessionId,
        kind: 'handoff',
        data: { reason: args.reason, summary: args.summary, auto: false },
      });
      return 'Conversación derivada a un asesor humano. No respondas más en este turno salvo para avisar que un asesor va a continuar.';
    },
  });
}
