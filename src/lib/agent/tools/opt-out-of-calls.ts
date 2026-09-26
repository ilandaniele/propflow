import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { E164_RE } from '@/lib/widget/channel';
import { addDoNotCall } from '../voice/dnc';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  reason: z.string().max(200).optional().describe('Motivo por el que no quiere que lo llamen, si lo dio'),
});

export function makeOptOutOfCallsTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'opt_out_of_calls',
    description:
      'Usala cuando el usuario pida explícitamente que no lo llamen más. Solo afecta llamadas de voz — ' +
      'nunca deja de escribirle por WhatsApp.',
    inputSchema: InputSchema,
    run: async (args) => {
      if (ctx.dryRun) {
        return '[SIMULACIÓN — playground] Se registraría que este número no debe ser llamado.';
      }

      // Only a genuine E.164 external id is a phone number — a web session id
      // or a callerless voice id ('call:<vapiCallId>') never reaches here.
      if (!E164_RE.test(ctx.externalId)) {
        return 'Listo, lo anoto — aunque no tengo un número confirmado para bloquear llamadas.';
      }

      await addDoNotCall({ orgId: ctx.orgId, phoneE164: ctx.externalId, source: 'caller_request', reason: args.reason ?? null });
      return 'Listo, no te vamos a volver a llamar.';
    },
  });
}
