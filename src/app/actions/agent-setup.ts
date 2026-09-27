'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { db } from '@/lib/db';
import { orgChannels } from '@/lib/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { E164_RE } from '@/lib/widget/channel';
import { META_API_HOST, META_API_VERSION } from '@/lib/whatsapp/meta-provider';
import type { ActionResult } from '@/lib/errors';

const SETUP_PATH = '/dashboard/agent/setup';
const PHONE_NUMBER_ID_RE = /^\d{6,20}$/;
const GRAPH_VERIFY_TIMEOUT_MS = 10_000;

const SaveWhatsAppChannelSchema = z.object({
  phoneNumberId: z.string().regex(PHONE_NUMBER_ID_RE, 'Debe ser un phone number ID numérico de Meta'),
  displayPhoneE164: z.string().regex(E164_RE, 'Debe ser un teléfono E.164, ej. +51987654321'),
});

export type SaveWhatsAppChannelInput = z.infer<typeof SaveWhatsAppChannelSchema>;

export interface SaveWhatsAppChannelResult {
  /** Set when WHATSAPP_PHONE_NUMBER_ID isn't configured server-side yet, so the
   * match against it (and the Graph ownership check) couldn't run. */
  warning?: string;
}

interface WhatsAppChannelConfig {
  displayPhoneE164?: string | null;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Confirms this phoneNumberId actually belongs to displayPhoneE164 on Meta's
 * side — GET .../{phoneNumberId}?fields=display_phone_number and compare
 * digits (Meta formats the number differently than our E.164 input). Only
 * runs when WHATSAPP_ACCESS_TOKEN is set; the token itself is never logged or
 * returned.
 */
async function verifyPhoneNumberOwnership(
  phoneNumberId: string,
  displayPhoneE164: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) return { ok: true };

  try {
    const res = await fetch(
      `${META_API_HOST}/${META_API_VERSION}/${phoneNumberId}?fields=display_phone_number`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(GRAPH_VERIFY_TIMEOUT_MS),
      }
    );

    if (!res.ok) {
      log.warn('[agent-setup] phone number ownership check failed', { status: res.status });
      return {
        ok: false,
        message: 'No se pudo verificar el Phone number ID con Meta. Revisá que el ID sea correcto y volvé a intentar.',
      };
    }

    const data = (await res.json()) as { display_phone_number?: string };
    const remoteDigits = digitsOnly(data.display_phone_number ?? '');
    const inputDigits = digitsOnly(displayPhoneE164);

    if (!remoteDigits || remoteDigits !== inputDigits) {
      return {
        ok: false,
        message: 'El teléfono ingresado no coincide con el número que Meta tiene asociado a este Phone number ID.',
      };
    }

    return { ok: true };
  } catch (e) {
    log.warn('[agent-setup] phone number ownership check threw', { error: e instanceof Error ? e.message : 'unknown' });
    return {
      ok: false,
      message: 'No se pudo verificar el Phone number ID con Meta. Intentá nuevamente en unos minutos.',
    };
  }
}

/**
 * Binds this org's WhatsApp phone_number_id + display number to org_channels
 * (channel='whatsapp') — the row the webhook and the widget's wa.me link
 * both read.
 *
 * Rejects:
 * - a phoneNumberId already bound to ANOTHER org (org_channels_one_whatsapp_per_org,
 *   migration 0012, backs this up at the DB level too — see the 23505 branch below).
 * - a phoneNumberId that doesn't match WHATSAPP_PHONE_NUMBER_ID, once that env
 *   var is set server-side (before that, the value can't be checked — a
 *   warning is returned instead so the setup wizard can flag it).
 * - a displayPhoneE164 that Meta itself doesn't associate with phoneNumberId,
 *   when WHATSAPP_ACCESS_TOKEN is set.
 */
export async function saveWhatsAppChannel(input: SaveWhatsAppChannelInput): Promise<ActionResult<SaveWhatsAppChannelResult>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_setup_whatsapp_channel');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SaveWhatsAppChannelSchema.safeParse(input);
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { phoneNumberId, displayPhoneE164 } = parsed.data;

  let warning: string | undefined;
  const envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (envPhoneNumberId) {
    if (phoneNumberId !== envPhoneNumberId) {
      return Errors.VALIDATION_ERROR({
        formErrors: ['El Phone number ID debe coincidir con WHATSAPP_PHONE_NUMBER_ID configurado en el servidor'],
        fieldErrors: {},
      });
    }
  } else {
    warning = 'WHATSAPP_PHONE_NUMBER_ID todavía no está configurado en el servidor — este valor no pudo verificarse contra el secreto.';
  }

  if (process.env.WHATSAPP_ACCESS_TOKEN) {
    const ownership = await verifyPhoneNumberOwnership(phoneNumberId, displayPhoneE164);
    if (!ownership.ok) {
      return Errors.VALIDATION_ERROR({ formErrors: [ownership.message], fieldErrors: {} });
    }
  }

  try {
    await db.transaction(async (tx) => {
      const conflictRows = await tx
        .select({ orgId: orgChannels.orgId })
        .from(orgChannels)
        .where(and(
          eq(orgChannels.channel, 'whatsapp'),
          eq(orgChannels.externalId, phoneNumberId),
          ne(orgChannels.orgId, ctx.orgId),
        ))
        .limit(1);
      if (conflictRows.length > 0) {
        throw Errors.CONFLICT('Este phone number ID ya está vinculado a otra organización.');
      }

      const existingRows = await tx
        .select({ id: orgChannels.id, config: orgChannels.config })
        .from(orgChannels)
        .where(and(eq(orgChannels.orgId, ctx.orgId), eq(orgChannels.channel, 'whatsapp')))
        .limit(1);
      const existing = existingRows[0];

      const nextConfig: WhatsAppChannelConfig = {
        ...((existing?.config as WhatsAppChannelConfig) ?? {}),
        displayPhoneE164,
      };

      if (existing) {
        await tx
          .update(orgChannels)
          .set({ externalId: phoneNumberId, config: nextConfig, updatedAt: new Date() })
          .where(eq(orgChannels.id, existing.id));
      } else {
        await tx.insert(orgChannels).values({
          orgId: ctx.orgId,
          channel: 'whatsapp',
          externalId: phoneNumberId,
          config: nextConfig,
        });
      }
    });
  } catch (e) {
    // A pre-thrown ActionResult (the cross-org conflict check above) — surface as-is.
    if (e && typeof e === 'object' && 'error' in e) return e as ActionResult<never>;

    const code = (e as { code?: string } | null)?.code;
    if (code === '23505') {
      return Errors.CONFLICT('Este phone number ID ya está vinculado a otra organización.');
    }

    log.error('[agent-setup] saveWhatsAppChannel failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_setup_whatsapp_channel', 'agent_config', ctx.orgId);
  revalidatePath(SETUP_PATH);
  return ok({ warning });
}
