/**
 * Generic notification fan-out handler.
 * Writes in-app notification_inbox rows for various events.
 * Extended in future to send email or WhatsApp per tenant.preferred_language.
 */

import { log } from '@/lib/log';
import type { EventPayload } from '../types';

export async function handleNotificationFanout(
  payload: EventPayload
): Promise<void> {
  // Generic fan-out — log for now; specific handlers above do the real work
  log.debug('[notification-fanout] event received', { event: JSON.stringify(payload).slice(0, 100) });
}
