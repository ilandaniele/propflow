/**
 * The widget's call-to-action — always derived from DB state (a pending or
 * freshly-created handoff code), never parsed from the model's reply text
 * (§4 "cta.ts (C)").
 */

import { createHandoffCode, getLatestPendingCode, buildWhatsAppDeepLink, type HandoffCodeRow } from './handoff-codes';
import type { WebCta } from '@/lib/agent/types';

export interface ComputeWebCtaArgs {
  orgId: string;
  webSessionId: string;
  leadId: string | null;
  displayPhone: string | null;
  forceContinue: boolean;
}

function labelFor(kind: HandoffCodeRow['kind']): string {
  return kind === 'visit' ? 'Confirmar visita por WhatsApp' : 'Seguir por WhatsApp';
}

function prefilledText(code: HandoffCodeRow): string {
  return code.kind === 'visit'
    ? `Hola, confirmo mi visita. Código ${code.code}`
    : `Hola, quiero seguir por WhatsApp. Código ${code.code}`;
}

export async function computeWebCta(a: ComputeWebCtaArgs): Promise<WebCta | null> {
  if (!a.displayPhone) return null;

  let code = await getLatestPendingCode(a.orgId, a.webSessionId);

  if (!code && a.forceContinue) {
    code = await createHandoffCode({
      orgId: a.orgId,
      webSessionId: a.webSessionId,
      kind: 'continue',
      leadId: a.leadId,
    });
  }

  if (!code) return null;

  return {
    kind: 'whatsapp',
    url: buildWhatsAppDeepLink(a.displayPhone, prefilledText(code)),
    label: labelFor(code.kind),
    code: code.code,
    purpose: code.kind,
  };
}
