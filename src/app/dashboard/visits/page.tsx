import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentAdvisorSettings, crmLeads, listings, profiles } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { listVisitsInRange } from '@/lib/agent/visits/service';
import { resolveWeekRange } from './_lib/week';
import { VisitsWeekClient } from './VisitsWeekClient';

export const metadata: Metadata = { title: 'Visitas' };

const RECENT_LEADS_LIMIT = 50;

interface VisitsSearchParams {
  week?: string;
  advisor?: string;
}

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<VisitsSearchParams>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const params = await searchParams;
  const tNav = await getTranslations('navigation');
  const config = await getOrCreateAgentConfig(ctx.orgId);
  const week = resolveWeekRange(params.week, new Date(), config.timezone);
  const advisorFilter = params.advisor && params.advisor !== 'all' ? params.advisor : undefined;

  const [visits, advisorRows, listingRows, leadRows] = await Promise.all([
    listVisitsInRange(ctx.orgId, week.fromUtc, week.toUtc, advisorFilter),
    db
      .select({ id: profiles.id, fullName: profiles.fullName, acceptsVisits: agentAdvisorSettings.acceptsVisits })
      .from(agentAdvisorSettings)
      .innerJoin(profiles, and(eq(profiles.id, agentAdvisorSettings.profileId), eq(profiles.orgId, ctx.orgId)))
      .where(and(eq(agentAdvisorSettings.orgId, ctx.orgId), eq(profiles.role, 'admin'), eq(agentAdvisorSettings.acceptsVisits, true))),
    db
      .select({ id: listings.id, title: listings.title })
      .from(listings)
      .where(eq(listings.orgId, ctx.orgId)),
    db
      .select({ id: crmLeads.id, fullName: crmLeads.fullName, phone: crmLeads.phone })
      .from(crmLeads)
      .where(eq(crmLeads.orgId, ctx.orgId))
      .orderBy(desc(crmLeads.createdAt))
      .limit(RECENT_LEADS_LIMIT),
  ]);

  return (
    <VisitsWeekClient
      timezone={config.timezone}
      weekStart={week.weekStart}
      days={week.days}
      visits={visits.map((v) => ({
        id: v.id,
        startsAt: v.startsAt.toISOString(),
        endsAt: v.endsAt.toISOString(),
        status: v.status,
        profileId: v.profileId,
        advisorName: v.advisorName,
        listingTitle: v.listingTitle,
        leadName: v.leadName,
      }))}
      advisors={advisorRows.map((a) => ({ id: a.id, fullName: a.fullName ?? a.id }))}
      listings={listingRows.map((l) => ({ id: l.id, title: l.title ?? l.id }))}
      recentLeads={leadRows.map((l) => ({ id: l.id, fullName: l.fullName, phone: l.phone }))}
      selectedAdvisor={params.advisor ?? 'all'}
      availabilityLabel={tNav('visitsAvailability')}
    />
  );
}
