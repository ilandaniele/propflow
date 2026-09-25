import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getOrCreateAgentConfig } from '../config';
import { listLeadActiveVisits } from '../visits/service';
import { formatSlotLabel } from '../visits/slots';
import type { AgentToolContext } from './context';

const InputSchema = z.object({});

export function makeGetMyVisitsTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'get_my_visits',
    description: 'Lista las visitas activas agendadas por este mismo lead. Usalo antes de reprogramar o cancelar con reschedule_visit / cancel_visit.',
    inputSchema: InputSchema,
    run: async () => {
      const leadId = ctx.leadIdRef.current;
      if (!leadId) return 'No tenés visitas agendadas todavía.';

      const visits = await listLeadActiveVisits(ctx.orgId, leadId);
      if (visits.length === 0) return 'No tenés visitas agendadas todavía.';

      const config = await getOrCreateAgentConfig(ctx.orgId);
      return visits
        .map((v) => `${v.id} — ${v.listingTitle ?? 'Propiedad'} — ${formatSlotLabel(v.startsAt, config.timezone)}`)
        .join('\n');
    },
  });
}
