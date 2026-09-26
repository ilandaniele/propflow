/**
 * CalendarDriftBanner — item C. Server component listing the org's visits
 * flagged 'drift' or 'detached' by the sync engine (item B) within the
 * displayed week, with the two resolve buttons (blueprint §4).
 *
 * A moved event ('drift') offers "keep PropFlow time" (re-pushes) or "apply
 * Google time" (reschedules) via bound calls to the resolveCalendarDrift
 * Server Action, submitted as plain <form>s — no client JS required. A
 * deleted event ('detached') is acknowledge-only — the visit stays active in
 * PropFlow (assumption 6); there is nothing to resolve.
 */

import { db } from '@/lib/db';
import { crmLeads, profiles, propertyVisits } from '@/lib/db/schema';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { resolveCalendarDrift } from '@/app/actions/calendar';

interface CalendarDriftBannerProps {
  orgId: string;
  weekFromUtc: Date;
  weekToUtc: Date;
}

export async function CalendarDriftBanner({ orgId, weekFromUtc, weekToUtc }: CalendarDriftBannerProps) {
  const t = await getTranslations('calendar');

  const rows = await db
    .select({
      id: propertyVisits.id,
      startsAt: propertyVisits.startsAt,
      googleSyncStatus: propertyVisits.googleSyncStatus,
      leadName: crmLeads.fullName,
      advisorName: profiles.fullName,
    })
    .from(propertyVisits)
    .leftJoin(crmLeads, eq(crmLeads.id, propertyVisits.leadId))
    .leftJoin(profiles, eq(profiles.id, propertyVisits.profileId))
    .where(
      and(
        eq(propertyVisits.orgId, orgId),
        inArray(propertyVisits.googleSyncStatus, ['drift', 'detached']),
        gte(propertyVisits.startsAt, weekFromUtc),
        lt(propertyVisits.startsAt, weekToUtc),
      ),
    )
    .orderBy(asc(propertyVisits.startsAt));

  if (rows.length === 0) return null;

  // Inline Server Actions (Next.js form-action convention): wrap the shared
  // resolveCalendarDrift Server Action so the <form action> return type is
  // void, not ActionResult — form actions don't consume a return value.
  async function keepPropflowTime(visitId: string) {
    'use server';
    await resolveCalendarDrift({ visitId, keep: 'propflow' });
  }
  async function applyGoogleTime(visitId: string) {
    'use server';
    await resolveCalendarDrift({ visitId, keep: 'google' });
  }

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">{t('driftTitle')}</p>
      <ul className="space-y-2">
        {rows.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/60 px-3 py-2 text-sm">
            <div>
              <p className="font-medium text-slate-800">
                {v.leadName ?? '—'} · {v.advisorName ?? '—'}
              </p>
              <p className="text-slate-600">{new Date(v.startsAt).toLocaleString()}</p>
              <p className="text-xs text-slate-500">{v.googleSyncStatus === 'drift' ? t('driftBody') : t('detachedBody')}</p>
            </div>
            {v.googleSyncStatus === 'drift' && (
              <div className="flex gap-2">
                <form action={keepPropflowTime.bind(null, v.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('keepPropflow')}
                  </button>
                </form>
                <form action={applyGoogleTime.bind(null, v.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('applyGoogle')}
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
