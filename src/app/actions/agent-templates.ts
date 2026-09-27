'use server';

import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok } from '@/lib/errors';
import { log } from '@/lib/log';
import {
  isMetaTemplatesConfigured,
  syncTemplateCatalog,
  getTemplateStatusReport,
  type SyncResult,
  type TemplateStatusReport,
} from '@/lib/whatsapp/meta-templates-api';
import type { ActionResult } from '@/lib/errors';

const MISSING_ENV_VARS = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_BUSINESS_ACCOUNT_ID'];

function notConfiguredError(): ActionResult<never> {
  return Errors.VALIDATION_ERROR({
    formErrors: [`Faltan variables de entorno: ${MISSING_ENV_VARS.join(', ')}.`],
    fieldErrors: {},
  });
}

/** Submits every catalog template missing on the WABA to Meta for approval — never edits/deletes an existing one. */
export async function syncWhatsAppTemplates(): Promise<ActionResult<SyncResult[]>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'agent_templates_sync');
  if (!rl.success) return Errors.RATE_LIMITED();

  if (!isMetaTemplatesConfigured()) return notConfiguredError();

  let results: SyncResult[];
  try {
    results = await syncTemplateCatalog();
  } catch (e) {
    log.error('[agent-templates] syncWhatsAppTemplates failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'agent_templates_sync', 'whatsapp_templates', ctx.orgId);
  return ok(results);
}

/** Read-only status report joining the local catalog with Meta's per-template approval state. */
export async function getWhatsAppTemplateStatus(): Promise<ActionResult<TemplateStatusReport>> {
  try { await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!isMetaTemplatesConfigured()) return notConfiguredError();

  try {
    const report = await getTemplateStatusReport();
    return ok(report);
  } catch (e) {
    log.error('[agent-templates] getWhatsAppTemplateStatus failed', { error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }
}
