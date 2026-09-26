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
}
