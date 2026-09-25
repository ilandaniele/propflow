import type { AgentToolContext } from './context';
import { makeSearchListingsTool } from './search-listings';
import { makeGetListingDetailsTool } from './get-listing-details';
import { makeSendListingCardTool } from './send-listing-card';
import { makeUpdateLeadProfileTool } from './update-lead-profile';
import { makeHandoffToHumanTool } from './handoff-to-human';
import { makeRegisterOwnerLeadTool } from './register-owner-lead';

export type { AgentToolContext } from './context';

/** Builds a fresh set of tools bound to this turn's server-side context. Never reused across turns/sessions. */
export function buildAgentTools(ctx: AgentToolContext) {
  return [
    makeSearchListingsTool(ctx),
    makeGetListingDetailsTool(ctx),
    makeSendListingCardTool(ctx),
    makeUpdateLeadProfileTool(ctx),
    makeHandoffToHumanTool(ctx),
    makeRegisterOwnerLeadTool(ctx),
  ];
}
