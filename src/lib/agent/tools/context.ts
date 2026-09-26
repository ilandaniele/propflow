import type { AgentChannel } from '../session';

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
}
