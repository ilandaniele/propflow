'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import { normalizeOrigin } from '@/lib/widget/origins';
import { upsertWebChannel, rotateWebPublicKey, setWhatsAppDisplayPhone, E164_RE } from '@/lib/widget/channel';
import { setPublicPagesEnabled } from '@/lib/agent/config';
import type { ActionResult } from '@/lib/errors';

const WIDGET_PATH = '/dashboard/agent/widget';
const MAX_ORIGINS = 10;
// Mirrors widget/channel.ts's private ACCENT_COLOR_RE (not exported — channel.ts is item A's file).
const ACCENT_COLOR_RE = /^#[0-9a-f]{6}$/i;

const UpdateWidgetSchema = z.object({
  enabled: z.enum(['true', 'false']),
  origins: z.string().optional().default(''),
  daily_message_cap: z.string(),
  daily_session_cap: z.string(),
  greeting: z.string().max(2000).optional().default(''),
  accent_color: z.string().optional().default(''),
  whatsapp_display_phone: z.string().optional().default(''),
});

function fieldError(field: string, message: string): ActionResult<never> {
  return Errors.VALIDATION_ERROR({ formErrors: [], fieldErrors: { [field]: [message] } });
}

/** Saves the widget's on/off switch, allowed origins, caps, greeting, accent colour, and (optionally) the WhatsApp display number. */
export async function updateWidgetSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_widget_settings');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateWidgetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const originLines = parsed.data.origins.split('\n').map((l) => l.trim()).filter(Boolean);
  if (originLines.length > MAX_ORIGINS) return fieldError('origins', `Máximo ${MAX_ORIGINS} orígenes`);

  const allowedOrigins: string[] = [];
  for (const line of originLines) {
    const normalized = normalizeOrigin(line);
    if (!normalized) return fieldError('origins', `Origen inválido: ${line}`);
    allowedOrigins.push(normalized);
  }

  const dailyMessageCap = Number(parsed.data.daily_message_cap);
  if (!Number.isInteger(dailyMessageCap) || dailyMessageCap < 1 || dailyMessageCap > 5000) {
    return fieldError('daily_message_cap', 'Debe ser un entero entre 1 y 5000');
  }
  const dailySessionCap = Number(parsed.data.daily_session_cap);
  if (!Number.isInteger(dailySessionCap) || dailySessionCap < 1 || dailySessionCap > 5000) {
    return fieldError('daily_session_cap', 'Debe ser un entero entre 1 y 5000');
  }

  const greeting = parsed.data.greeting.trim() || null;
  const accentColorRaw = parsed.data.accent_color.trim();
  if (accentColorRaw && !ACCENT_COLOR_RE.test(accentColorRaw)) {
    return fieldError('accent_color', 'Debe ser un color hex, ej. #2563eb');
  }
  const accentColor = accentColorRaw || null;

  const whatsappPhone = parsed.data.whatsapp_display_phone.trim();
  if (whatsappPhone && !E164_RE.test(whatsappPhone)) {
    return fieldError('whatsapp_display_phone', 'Debe ser un teléfono E.164, ej. +51987654321');
  }

  try {
    await upsertWebChannel(ctx.orgId, {
      enabled: parsed.data.enabled === 'true',
      allowedOrigins,
      dailyMessageCap,
      dailySessionCap,
      greeting,
      accentColor,
    });

    if (whatsappPhone) {
      const attached = await setWhatsAppDisplayPhone(ctx.orgId, whatsappPhone);
      if (!attached) {
        return fieldError('whatsapp_display_phone', 'Esta organización todavía no tiene un canal de WhatsApp habilitado.');
      }
    }
  } catch (e) {
    log.error('[agent-widget] updateWidgetSettings failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_widget_settings', 'agent_config', ctx.orgId);
  revalidatePath(WIDGET_PATH);
  return ok(undefined);
}

/** Rotates the org's public widget key — invalidates the previous embed snippet immediately. */
export async function rotateWidgetKey(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_widget_rotate_key');
  if (!rl.success) return Errors.RATE_LIMITED();

  try {
    await rotateWebPublicKey(ctx.orgId);
  } catch (e) {
    log.error('[agent-widget] rotateWidgetKey failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_widget_rotate_key', 'agent_config', ctx.orgId);
  revalidatePath(WIDGET_PATH);
  return ok(undefined);
}

const SetPublicPagesSchema = z.object({ enabled: z.enum(['true', 'false']) });

/** Toggles /p/<orgSlug> catalogue pages on/off for this org (opt-in — Phase 7 decision 8). */
export async function setPublicPages(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_widget_public_pages');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SetPublicPagesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await setPublicPagesEnabled(ctx.orgId, parsed.data.enabled === 'true');
  } catch (e) {
    log.error('[agent-widget] setPublicPages failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_widget_public_pages', 'agent_config', ctx.orgId);
  revalidatePath(WIDGET_PATH);
  return ok(undefined);
}
