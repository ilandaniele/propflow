import type { AgentChannel } from '../session';
import type { AgentAttribution } from '../types';

/**
 * Server-side context every tool closes over. None of these fields are ever
 * supplied by the model — orgId/sessionId/channel/externalId come from the
 * caller of runAgentTurn, and leadIdRef is mutated only by our own code.
 */
export interface AgentToolContext {
  orgId: string;
  sessionId: string;
  channel: AgentChannel;
  externalId: string;
  /** true in the admin playground: mutating tools describe what they would do instead of writing. */
  dryRun: boolean;
  /** Mutable so update_lead_profile / register_owner_lead can report a newly-created lead back to runAgentTurn. */
  leadIdRef: { current: string | null };
  /** The session's stored attribution (decision 11), if any — lead-creating tools derive source_ref/source_meta from it. */
  attribution: AgentAttribution | null;
  /** Phase 7: the web session id when channel === 'web'; null on every other channel. Web-only tools (continue_on_whatsapp, book_visit's web branch) require this to write agent_web_handoff_codes. */
  webSessionId: string | null;
  /** Phase 8/9: this org's shadow mode, evaluated once per turn (run-turn.ts: `!dryRun && config.shadowMode`) — photo/card-sending tools suppress instead of sending. */
  shadowMode: boolean;
  /** Phase 9: the whatsapp_conversations id when channel === 'whatsapp'; null otherwise. Required by send_listing_photos (sendWhatsAppImage) and the per-session daily-send cap. */
  whatsappConversationId: string | null;
  /** Phase 8: the agent_calls id when channel === 'voice'; null otherwise. Required by book_visit's voice branch to attach a handoff code to the call. */
  voiceCallId: string | null;
}
