import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db/schema';
import { toE164 } from '@/lib/whatsapp/phone';
import { createHandoffCode } from '@/lib/widget/handoff-codes';
import { setWebSessionPhone } from '@/lib/widget/web-session';
import { getWhatsAppDisplayPhone } from '@/lib/widget/channel';
import { ensureLead } from './ensure-lead';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  phone: z.string().min(6).max(20).optional().describe('Teléfono del prospecto, si lo escribió en el chat'),
  reason: z.enum(['visit', 'questions', 'human']).optional().describe('Por qué quiere seguir por WhatsApp'),
});

/**
 * Web-only tool (registered in tools/index.ts only when ctx.channel === 'web'):
 * leaves a "continue on WhatsApp" handoff code that the widget renders as a
 * wa.me button. Never sends anything automated to the typed phone — the
 * phone is stored as UNVERIFIED (source_meta.phoneVerified=false) until the
 * visitor's own WhatsApp message redeems the code (web-handoff-redeem.ts).
 */
export function makeContinueOnWhatsappTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'continue_on_whatsapp',
    description:
      'Ofrece seguir la conversación por WhatsApp (para coordinar una visita, resolver dudas, o cuando el usuario pide hablar con alguien). ' +
      'Deja un botón de WhatsApp en el chat del sitio — no envía nada automáticamente al teléfono que te den.',
    inputSchema: InputSchema,
    run: async (args) => {
      if (ctx.dryRun) {
        return `[SIMULACIÓN — playground] Se dejaría un botón para seguir por WhatsApp (motivo: ${args.reason ?? 'no especificado'}).`;
      }

      if (!ctx.webSessionId) {
        // Defensive only — this tool is never registered outside the web channel.
        return 'No pude generar el enlace de WhatsApp en este canal.';
      }

      const displayPhone = await getWhatsAppDisplayPhone(ctx.orgId);
      if (!displayPhone) return 'Un asesor te va a contactar.';

      const leadId = await ensureLead(ctx);

      if (args.phone) {
        const phoneE164 = toE164(args.phone);
        await setWebSessionPhone(ctx.orgId, ctx.webSessionId, phoneE164);
        // Only fills a NULL phone — an anonymous web visitor's self-reported
        // number is never trusted enough to overwrite a phone the org
        // already had on file, and it's always stored unverified.
        await db
          .update(crmLeads)
          .set({
            phone: phoneE164,
            sourceMeta: sql`jsonb_set(coalesce(${crmLeads.sourceMeta}, '{}'::jsonb), '{phoneVerified}', 'false'::jsonb, true)`,
          })
          .where(and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId), isNull(crmLeads.phone)));
      }

      const code = await createHandoffCode({
        orgId: ctx.orgId,
        webSessionId: ctx.webSessionId,
        kind: 'continue',
        leadId,
      });
      if (!code) return 'Ya generaste varios pedidos hoy; esperá un momento y volvé a intentarlo.';

      return 'Listo, te dejé un botón para seguir por WhatsApp.';
    },
  });
}
