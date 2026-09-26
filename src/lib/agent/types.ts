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
  | 'reply_dropped';

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

export type { AgentChannel, AgentSessionMode };
