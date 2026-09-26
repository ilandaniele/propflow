import type { AgentToolContext } from './context';
import { makeSearchListingsTool } from './search-listings';
import { makeGetListingDetailsTool } from './get-listing-details';
import { makeSendListingCardTool } from './send-listing-card';
import { makeUpdateLeadProfileTool } from './update-lead-profile';
import { makeHandoffToHumanTool } from './handoff-to-human';
import { makeRegisterOwnerLeadTool } from './register-owner-lead';
import { makeGetAvailableSlotsTool } from './get-available-slots';
import { makeBookVisitTool } from './book-visit';
import { makeGetMyVisitsTool } from './get-my-visits';
import { makeRescheduleVisitTool } from './reschedule-visit';
import { makeCancelVisitTool } from './cancel-visit';

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
    makeGetAvailableSlotsTool(ctx),
    makeBookVisitTool(ctx),
    makeGetMyVisitsTool(ctx),
    makeRescheduleVisitTool(ctx),
    makeCancelVisitTool(ctx),
  ];
}
