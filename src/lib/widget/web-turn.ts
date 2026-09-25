/**
 * POST /api/agent/web/messages business logic — split out of the route
 * handler so it can be unit/integration-tested without a Request object
 * (blueprint §4, "handleWebMessage").
 */

import { webMessageRateLimit } from '@/lib/ratelimit';
import { runAgentTurn } from '@/lib/agent/run-turn';
import type { WebApiError, WebTurnResponse } from '@/lib/agent/types';
import type { WebChannel } from './channel';
import {
  recordWebMessage,
  setWebSessionContext,
  tryLockWebSession,
  unlockWebSession,
  webSessionExternalId,
  type WebSession,
} from './web-session';
import { incrementWebUsage } from './usage';
import { resolveListingRef } from './listing-ref';
import { computeWebCta } from './cta';

export interface HandleWebMessageArgs {
  channel: WebChannel;
  session: WebSession;
  text: string;
  listingRef: string | null;
  pageUrl: string | null;
  ip: string;
}

export interface HandleWebMessageResult {
  status: number;
  body: WebTurnResponse | WebApiError;
}

const DAILY_CAP_REPLY = 'Llegamos al límite de mensajes de hoy para este chat. Seguimos por WhatsApp.';
const FALLBACK_REPLY_WITH_ADVISOR = 'Un asesor va a seguir la conversación en breve. También podés escribirnos por WhatsApp.';
const FALLBACK_REPLY_NO_PHONE = 'Un asesor te va a contactar pronto.';

export async function handleWebMessage(a: HandleWebMessageArgs): Promise<HandleWebMessageResult> {
  const rate = webMessageRateLimit(a.ip, a.session.id);
  if (!rate.success) {
    return {
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'Demasiados mensajes, esperá un momento.', retryAfterMs: rate.retryAfterMs } },
    };
  }

  const usage = await incrementWebUsage(a.channel.orgId, 'messages', a.channel.dailyMessageCap);
  if (!usage.allowed) {
    // Body is a WebTurnResponse (not WebApiError) at 503 — the widget still
    // renders a bubble + CTA, it just can't reach the model for the rest of
    // the day. computeWebCta needs a leadId, which we may not have yet this
    // early (no turn has run) — null is fine, createHandoffCode accepts it.
    const cta = await computeWebCta({
      orgId: a.channel.orgId,
      webSessionId: a.session.id,
      leadId: null,
      displayPhone: a.channel.whatsappDisplayPhone,
      forceContinue: true,
    });
    return { status: 503, body: { reply: DAILY_CAP_REPLY, mode: 'handoff', cta } };
  }

  const locked = await tryLockWebSession(a.session.id);
  if (!locked) {
    return { status: 409, body: { error: { code: 'BUSY', message: 'Ya hay un mensaje en curso para esta conversación.' } } };
  }

  try {
    const pageContext = await resolveListingRef(a.channel.orgId, a.listingRef);
    await setWebSessionContext(a.session.id, {
      currentListingId: pageContext?.listingId ?? null,
      ...(a.pageUrl !== undefined ? { pageUrl: a.pageUrl } : {}),
    });

    const result = await runAgentTurn({
      orgId: a.channel.orgId,
      channel: 'web',
      externalId: webSessionExternalId(a.session.id),
      inboundText: a.text,
      pageContext,
      webSessionId: a.session.id,
    });

    await recordWebMessage(a.session.id, result.sessionId);

    const mode: WebTurnResponse['mode'] = result.skipped || result.handedOffToHuman ? 'handoff' : 'ai';
    const cta = await computeWebCta({
      orgId: a.channel.orgId,
      webSessionId: a.session.id,
      leadId: result.leadId,
      displayPhone: a.channel.whatsappDisplayPhone,
      forceContinue: mode === 'handoff',
    });

    const reply = result.skipped
      ? (a.channel.whatsappDisplayPhone ? FALLBACK_REPLY_WITH_ADVISOR : FALLBACK_REPLY_NO_PHONE)
      : result.replyText;

    return { status: 200, body: { reply, mode, cta } };
  } finally {
    // Always released, including when runAgentTurn throws — the caller
    // (the route handler) is responsible for turning that into a generic
    // 500 (§4: "never log text, phone or IP" applies there too).
    await unlockWebSession(a.session.id);
  }
}
