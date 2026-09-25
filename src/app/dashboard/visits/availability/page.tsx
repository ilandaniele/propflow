import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentAdvisorSettings, agentAvailability, agentAvailabilityExceptions, profiles } from '@/lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { AvailabilityClient } from './AvailabilityClient';
import { CalendarConnectionCard } from '../_components/CalendarConnectionCard';
import { getConnectionForProfile, listConnections } from '@/lib/calendar/connections';

export const metadata: Metadata = { title: 'Disponibilidad de asesores' };

export default async function VisitAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const now = new Date();
  const params = await searchParams;

  const [advisorRows, settingsRows, windowRows, exceptionRows, ownConnection, orgConnections] = await Promise.all([
    db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(and(eq(profiles.orgId, ctx.orgId), eq(profiles.role, 'admin'))),
    db.select().from(agentAdvisorSettings).where(eq(agentAdvisorSettings.orgId, ctx.orgId)),
    db.select().from(agentAvailability).where(eq(agentAvailability.orgId, ctx.orgId)),
    db
      .select()
      .from(agentAvailabilityExceptions)
      .where(and(eq(agentAvailabilityExceptions.orgId, ctx.orgId), gte(agentAvailabilityExceptions.endsAt, now))),
    getConnectionForProfile(ctx.orgId, ctx.profile.id),
    listConnections(ctx.orgId),
  ]);

  const isAdvisor = settingsRows.some((s) => s.profileId === ctx.profile.id);

  return (
    <>
      <CalendarConnectionCard
        isAdvisor={isAdvisor}
        own={
          ownConnection
            ? {
                googleEmail: ownConnection.googleEmail,
                status: ownConnection.status,
                freebusyEnabled: ownConnection.freebusyEnabled,
                writeEvents: ownConnection.writeEvents,
                lastSyncedAt: ownConnection.lastSyncedAt ? ownConnection.lastSyncedAt.toISOString() : null,
                lastError: ownConnection.lastError,
              }
            : null
        }
        orgConnections={orgConnections
          .filter((c) => c.profileId !== ctx.profile.id)
          .map((c) => ({
            id: c.id,
            profileName: c.profileName,
            googleEmail: c.googleEmail,
            status: c.status,
            lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
          }))}
        calendarParam={params.calendar ?? null}
      />
      <AvailabilityClient
        advisors={advisorRows.map((a) => ({ id: a.id, fullName: a.fullName ?? a.id }))}
        settings={settingsRows.map((s) => ({
          profileId: s.profileId,
          acceptsVisits: s.acceptsVisits,
          visitMinutes: s.visitMinutes,
          bufferMinutes: s.bufferMinutes,
          minNoticeMinutes: s.minNoticeMinutes,
          daysAhead: s.daysAhead,
          slotStepMinutes: s.slotStepMinutes,
        }))}
        windows={windowRows.map((w) => ({
          id: w.id,
          profileId: w.profileId,
          weekday: w.weekday,
          startMinute: w.startMinute,
          endMinute: w.endMinute,
        }))}
        exceptions={exceptionRows.map((e) => ({
          id: e.id,
          profileId: e.profileId,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt.toISOString(),
          kind: e.kind as 'block' | 'extra',
          reason: e.reason,
        }))}
      />
    </>
  );
}
