/**
 * EXTENSION POINT (Phase 3-4): a registry for WhatsApp button/list-reply
 * handlers, checked by the webhook dispatch BEFORE an inbound message is
 * handed to the agent turn (see whatsapp-dispatch.ts / the webhook route).
 * Phase 2 registers nothing here — it exists so Phase 3-4 can plug in
 * `handleVisitButtonReply` (visit scheduling) without touching the webhook
 * route or whatsapp-dispatch.ts again.
 *
 * A handler that returns true has fully handled the reply (e.g. it sent its
 * own WhatsApp message); the caller must NOT also queue an agent turn for
 * that message. Returning false means "not for me" — dispatch keeps trying
 * the remaining registered handlers, and falls through to the normal agent
 * pipeline if none matched.
 */

export interface ButtonReplyContext {
  orgId: string;
  conversationId: string;
  externalPhone: string; // PII — never log
  interactiveReplyId: string;
  text: string | null;
}

export type ButtonReplyMatcher = (interactiveReplyId: string) => boolean;
export type ButtonReplyHandler = (ctx: ButtonReplyContext) => Promise<boolean>;

interface Registration {
  matcher: ButtonReplyMatcher;
  handler: ButtonReplyHandler;
}

const REGISTRY: Registration[] = [];

/** Register a handler for button/list replies whose id satisfies `matcher`. */
export function registerButtonReplyHandler(matcher: ButtonReplyMatcher, handler: ButtonReplyHandler): void {
  REGISTRY.push({ matcher, handler });
}

/** Test-only: clears every registration. */
export function _resetButtonReplyHandlers(): void {
  REGISTRY.length = 0;
}

/**
 * Runs every matching handler in registration order until one reports it
 * handled the reply. Returns true if any handler did.
 */
export async function dispatchButtonReply(ctx: ButtonReplyContext): Promise<boolean> {
  for (const { matcher, handler } of REGISTRY) {
    if (!matcher(ctx.interactiveReplyId)) continue;
    if (await handler(ctx)) return true;
  }
  return false;
}
