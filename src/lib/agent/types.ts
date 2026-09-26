/**
 * Shared agent types (Phase 2). The single source of truth for the
 * RunAgentTurnArgs/RunAgentTurnResult contract between run-turn.ts (B),
 * whatsapp-dispatch.ts (C) and the inbox actions (D). No runtime
 * dependencies — safe to import from schema.ts with `import type`.
 */

import type { AgentChannel, AgentSessionMode } from './session';

export type AgentLanguage = 'es' | 'en' | 'pt';
export type HandoffReason = 'tool' | 'budget' | 'turn_cap' | 'manual';
export type AgentEventKind =
  | 'handoff'
  | 'mode_change'
  | 'suggestion_created'
  | 'suggestion_sent'
  | 'suggestion_discarded'
  | 'attribution'
  | 'window_closed'
  | 'turn_error'
  | 'reply_dropped'
  /** Phase 9 (item T): send_listing_photos suppressed by shadow mode. */
  | 'photos_suppressed'
  /** Phase 8 (item C): a Phase 7 web/voice handoff code was redeemed on WhatsApp. */
  | 'web_handoff_redeemed'
  /** Phase 8 (item B): end-of-call-report persisted for an agent_calls row. */
  | 'voice_call';

export interface AgentAttribution {
  type: 'ctwa' | 'wa_link';
  sourceId?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  headline?: string | null;
  ctwaClid?: string | null;
  refCode?: string | null;
  listingId?: string | null;
  capturedAt: string; // ISO
}

/** Phase 7: the listing a web visitor is looking at when they open the widget or navigate a /p page. */
export interface AgentPageContext {
  listingId: string;
  title: string | null;
  refCode: string | null;
  publicSlug: string | null;
}

export interface RunAgentTurnArgs {
  orgId: string;
  channel: AgentChannel;
  externalId: string;
  whatsappConversationId?: string | null;
  inboundText: string;
  /** true from the admin playground: mutating tools describe instead of writing, and no budget is spent against the org. */
  dryRun?: boolean;
  /** Outbound messages with sender_kind='human' created since the session's last agent turn — volatile turn context, never cached history. */
  humanRepliesSinceLastTurn?: string[];
  /** Phase 7: the web listing page/widget context, if any. Never in the cached system block — see buildTurnContext. */
  pageContext?: AgentPageContext | null;
  /** Phase 7: extra volatile notes for this turn only (e.g. a WhatsApp handoff-code redemption outcome). Sanitized to 500 chars each. */
  extraContextNotes?: string[];
  /** Phase 7: set only on the web channel — threaded into AgentToolContext so web-only tools (continue_on_whatsapp, book_visit's web branch) can act. */
  webSessionId?: string | null;
}

export interface RunAgentTurnResult {
  sessionId: string;
  leadId: string | null;
  replyText: string;
  handedOffToHuman: boolean;
  handoffReason: HandoffReason | null;
  /** true => mode != 'ai' (or another gate failed); nothing to send, the model was never called. */
  skipped: boolean;
  language: AgentLanguage | null;
  /**
   * OVERRIDE (item A "Override" note in handoffs/phase2-blueprint.md): the id
   * of the assistant agent_messages row this turn persisted, or null when
   * skipped/dryRun. In shadow mode, the caller (whatsapp-dispatch.ts) passes
   * this to createSuggestion() so approve/discard can flip the row's
   * send_status instead of leaving an unsent draft in the LLM history.
   */
  assistantMessageId: string | null;
}

/** Phase 7: the widget's call-to-action, always derived from DB state (a pending/created handoff code) — never parsed from model text. */
export interface WebCta {
  kind: 'whatsapp';
  url: string;
  label: string;
  code: string | null;
  purpose: 'visit' | 'continue';
}

export interface WebTurnResponse {
  reply: string;
  mode: 'ai' | 'handoff';
  cta: WebCta | null;
}

export interface WebApiError {
  error: {
    code: 'VALIDATION' | 'SESSION' | 'NOT_FOUND' | 'FORBIDDEN_ORIGIN' | 'BUSY' | 'RATE_LIMITED' | 'DAILY_CAP';
    message: string;
    retryAfterMs?: number;
  };
}

export type { AgentChannel, AgentSessionMode };
