/**
 * Fire-and-forget hook service.ts calls after committing a visit change, so
 * that the Google Calendar push (item B) stays out of the booking
 * transaction and never fails a booking. A lazy import avoids a hard
 * dependency from the visits domain onto the calendar domain — Phase 3/4
 * (visits) shipped before Phase 5 (calendar) exists, and this keeps that
 * layering intact.
 */

import { log } from '@/lib/log';

export type VisitChangeKind = 'created' | 'rescheduled_from' | 'rescheduled_to' | 'cancelled' | 'status';

export function notifyVisitChanged(c: { orgId: string; visitId: string; profileId: string; kind: VisitChangeKind }): void {
  void (async () => {
    try {
      const { enqueueVisitPush } = await import('@/lib/calendar/push');
      await enqueueVisitPush(c.orgId, c.visitId, c.profileId);
    } catch (e) {
      // Never let a calendar push failure surface to the caller — the
      // booking already committed. No PII in the log line.
      log.warn('[agent/visits/hooks] notifyVisitChanged failed', { orgId: c.orgId, kind: c.kind, error: (e as Error).message });
    }
  })();
}
