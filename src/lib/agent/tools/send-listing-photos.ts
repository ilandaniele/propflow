import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { db } from '@/lib/db';
import { listings, unitImages, listingImages, whatsappMessages } from '@/lib/db/schema';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage';
import { getOrCreateAgentConfig } from '../config';
import { isListingKnownToSession } from '../session-listings';
import { sendWhatsAppImage } from '../outbound';
import { recordAgentEvent } from '../events';
import type { AgentToolContext } from './context';

const InputSchema = z.object({
  listingId: z.string().uuid().describe('Id de la propiedad, devuelto por search_listings'),
  max: z.number().int().min(1).max(10).optional().describe('Máximo de fotos a enviar, si el usuario pidió una cantidad puntual'),
});

/** 3 send_listing_photos calls per WhatsApp session per day — a coarse abuse guard, not a hard product limit. */
const MAX_CALLS_PER_SESSION_PER_DAY = 3;

function utcDayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function priceText(price: string | null, currency: string): string {
  return price ? `${currency} ${price}` : 'a consultar';
}

export function makeSendListingPhotosTool(ctx: AgentToolContext) {
  return betaZodTool({
    name: 'send_listing_photos',
    description:
      'Envía por WhatsApp las fotos reales de una propiedad ya buscada con search_listings. ' +
      'No inventes que las enviaste si esta herramienta no lo confirma. Solo disponible por WhatsApp.',
    inputSchema: InputSchema,
    run: async (args) => {
      const config = await getOrCreateAgentConfig(ctx.orgId);
      const cap = Math.min(args.max ?? config.maxListingPhotos, config.maxListingPhotos);

      if (ctx.dryRun) {
        return `[SIMULACIÓN — playground] Se enviarían hasta ${cap} fotos de la propiedad ${args.listingId}.`;
      }

      if (ctx.shadowMode) {
        await recordAgentEvent({
          orgId: ctx.orgId,
          sessionId: ctx.sessionId,
          kind: 'photos_suppressed',
          data: { listingId: args.listingId },
        });
        return 'No enviado (modo sombra).';
      }

      const known = await isListingKnownToSession(ctx.orgId, ctx.sessionId, args.listingId);
      if (!known) return 'Primero buscá la propiedad con search_listings.';

      if (!ctx.whatsappConversationId) return 'Las fotos solo se pueden enviar por WhatsApp.';

      const sentToday = await db
        .select({ batch: sql<string>`${whatsappMessages.meta}->>'batch'` })
        .from(whatsappMessages)
        .where(and(
          eq(whatsappMessages.conversationId, ctx.whatsappConversationId),
          eq(whatsappMessages.direction, 'outbound'),
          sql`${whatsappMessages.meta}->>'kind' = 'listing_photos'`,
          gte(whatsappMessages.createdAt, utcDayStart()),
        ));
      const callsToday = new Set(sentToday.map((r) => r.batch)).size;
      if (callsToday >= MAX_CALLS_PER_SESSION_PER_DAY) {
        return 'Ya enviamos fotos varias veces hoy en esta conversación; seguimos por texto.';
      }

      const listingRows = await db
        .select({
          id: listings.id,
          title: listings.title,
          price: listings.price,
          currency: listings.currency,
          unitId: listings.unitId,
        })
        .from(listings)
        .where(and(eq(listings.id, args.listingId), eq(listings.orgId, ctx.orgId), eq(listings.published, true)))
        .limit(1);
      const listing = listingRows[0];
      if (!listing) return 'No se encontró esa propiedad, o ya no está publicada.';

      const images = listing.unitId
        ? await db
            .select({ path: unitImages.storagePath })
            .from(unitImages)
            .where(and(eq(unitImages.unitId, listing.unitId), eq(unitImages.orgId, ctx.orgId)))
            .orderBy(desc(unitImages.isCover), asc(unitImages.sortOrder))
            .limit(cap)
        : await db
            .select({ path: listingImages.storagePath })
            .from(listingImages)
            .where(and(eq(listingImages.listingId, listing.id), eq(listingImages.orgId, ctx.orgId)))
            .orderBy(desc(listingImages.isCover), asc(listingImages.sortOrder))
            .limit(cap);

      if (images.length === 0) return 'Todavía no hay fotos cargadas de esa propiedad.';

      const bucket = listing.unitId ? 'unit-images' : 'listing-images';
      const batch = randomUUID();
      const caption = `${listing.title ?? 'Propiedad'} · ${priceText(listing.price, listing.currency)}`;
      let sent = 0;

      for (const image of images) {
        const imageUrl = await getSignedUrl(bucket, image.path, 600);
        const result = await sendWhatsAppImage({
          orgId: ctx.orgId,
          conversationId: ctx.whatsappConversationId,
          imageUrl,
          caption: sent === 0 ? caption : null,
          senderKind: 'agent',
          meta: { kind: 'listing_photos', batch, listingId: listing.id },
        });
        if (!result.ok) break;
        sent++;
      }

      if (sent === 0) return 'No pude enviar las fotos ahora; intentá de nuevo en un momento.';
      return `Envié ${sent} fotos de ${listing.title ?? 'la propiedad'}.`;
    },
  });
}
