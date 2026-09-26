import type { AgentToolContext } from './context';
import { isToolEnabledForChannel } from './channels';
import { makeSearchListingsTool } from './search-listings';
import { makeGetListingDetailsTool } from './get-listing-details';
import { makeSendListingCardTool } from './send-listing-card';
import { makeSendListingPhotosTool } from './send-listing-photos';
import { makeUpdateLeadProfileTool } from './update-lead-profile';
import { makeHandoffToHumanTool } from './handoff-to-human';
import { makeRegisterOwnerLeadTool } from './register-owner-lead';
import { makeGetAvailableSlotsTool } from './get-available-slots';
import { makeBookVisitTool } from './book-visit';
import { makeGetMyVisitsTool } from './get-my-visits';
import { makeRescheduleVisitTool } from './reschedule-visit';
import { makeCancelVisitTool } from './cancel-visit';
import { makeConfirmMyVisitTool } from './confirm-my-visit';
import { makeOptOutOfCallsTool } from './opt-out-of-calls';
import { makeContinueOnWhatsappTool } from './continue-on-whatsapp';

export type { AgentToolContext } from './context';

/**
 * Builds a fresh set of tools bound to this turn's server-side context, then
 * filters them through TOOL_CHANNELS (channels.ts) so a tool that makes no
 * sense on this channel (e.g. send_listing_photos on web, continue_on_whatsapp
 * on voice) is never even offered to the model. Never reused across
 * turns/sessions — voice's buildVapiAssistant applies the same filter again
 * itself (belt-and-suspenders), so this is the single source of truth both
 * paths agree on.
 */
export function buildAgentTools(ctx: AgentToolContext) {
  const tools = [
    makeSearchListingsTool(ctx),
    makeGetListingDetailsTool(ctx),
    makeSendListingCardTool(ctx),
    makeSendListingPhotosTool(ctx),
    makeUpdateLeadProfileTool(ctx),
    makeHandoffToHumanTool(ctx),
    makeRegisterOwnerLeadTool(ctx),
    makeGetAvailableSlotsTool(ctx),
    makeBookVisitTool(ctx),
    makeGetMyVisitsTool(ctx),
    makeRescheduleVisitTool(ctx),
    makeCancelVisitTool(ctx),
    makeConfirmMyVisitTool(ctx),
    makeOptOutOfCallsTool(ctx),
    makeContinueOnWhatsappTool(ctx),
  ];
  return tools.filter((t) => isToolEnabledForChannel(t.name, ctx.channel));
}
