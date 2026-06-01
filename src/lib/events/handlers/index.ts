/**
 * Handler registry — imports all handlers to register them on module load.
 * Called once at startup (imported from webhook route or cron route).
 */

import { on } from '../emit';
import { handleWhatsAppReceipt } from './whatsapp-receipt';
import { handleTaskProof } from './task-proof';
import { handleSanctionApproved } from './sanction-approved';
import { handleWhatsAppDisputeKeyword } from './whatsapp-dispute-keyword';
import { handleNotificationFanout } from './notification-fanout';

let registered = false;

export function registerAllHandlers(): void {
  if (registered) return;
  registered = true;

  on('whatsapp.attachment.received', handleWhatsAppReceipt);
  on('task.proof_received',          handleTaskProof);
  on('sanction.approved',            handleSanctionApproved);
  on('whatsapp.message.received',    handleWhatsAppDisputeKeyword);
  on('payment.receipt.approved',     handleNotificationFanout);
  on('sanction.proposed',            handleNotificationFanout);
  on('sanction.disputed',            handleNotificationFanout);
  on('task.expired',                 handleNotificationFanout);
}
