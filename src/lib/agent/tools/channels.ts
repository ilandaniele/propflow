/**
 * Which tools are offered on which channel (blueprint §2.5). Item T's
 * tools/index.ts filters `buildAgentTools()`'s output through
 * `isToolEnabledForChannel`; this module owns the table so every channel
 * (including voice's tool-adapter) agrees on the same set.
 */

import type { AgentChannel } from '../session';

export const TOOL_CHANNELS: Readonly<Record<string, ReadonlyArray<AgentChannel>>> = {
  search_listings: ['whatsapp', 'web', 'voice'],
  get_listing_details: ['whatsapp', 'web', 'voice'],
  update_lead_profile: ['whatsapp', 'web', 'voice'],
  handoff_to_human: ['whatsapp', 'web', 'voice'],
  register_owner_lead: ['whatsapp', 'web', 'voice'],
  get_available_slots: ['whatsapp', 'web', 'voice'],
  book_visit: ['whatsapp', 'web', 'voice'],
  get_my_visits: ['whatsapp', 'web', 'voice'],
  cancel_visit: ['whatsapp', 'web', 'voice'],
  confirm_my_visit: ['whatsapp', 'web', 'voice'],
  send_listing_card: ['whatsapp', 'web'],
  reschedule_visit: ['whatsapp', 'web'],
  continue_on_whatsapp: ['web'],
  send_listing_photos: ['whatsapp'],
  opt_out_of_calls: ['whatsapp', 'voice'],
};

/** Unknown tool name => false (fail closed). */
export function isToolEnabledForChannel(name: string, ch: AgentChannel): boolean {
  const channels = TOOL_CHANNELS[name];
  return channels ? channels.includes(ch) : false;
}
