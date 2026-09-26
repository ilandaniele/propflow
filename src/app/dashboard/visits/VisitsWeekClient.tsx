'use client';

/**
 * Week view for /dashboard/visits — 7 day columns of status-colored visit
 * cards, prev/next/today navigation, an advisor filter and the "new visit"
 * dialog. All mutations go through src/app/actions/visits.ts.
 */

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  cancelVisitStaff,
  confirmVisitStaff,
  markVisitOutcomeAction,
  rescheduleVisitStaff,
} from '@/app/actions/visits';
import type { ActionResult } from '@/lib/errors';
import { addCalendarDays, formatDateParts, type DateParts } from './_lib/week';
import { NewVisitDialog, type AdvisorOption, type LeadOption, type ListingOption } from './NewVisitDialog';

export interface VisitCardData {
  id: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  status: string;
  profileId: string;
  advisorName: string | null;
  listingTitle: string | null;
  leadName: string | null;
}

export interface VisitsWeekClientProps {
  timezone: string;
  weekStart: string;
  days: DateParts[];
  visits: VisitCardData[];
  advisors: AdvisorOption[];
  listings: ListingOption[];
  recentLeads: LeadOption[];
  selectedAdvisor: string;
  availabilityLabel: string;
}

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  scheduled: 'info',
  confirmed: 'success',
  completed: 'success',
  no_show: 'danger',
  cancelled: 'default',
  rescheduled: 'default',
};

const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed']);

function timeLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

function errorMessageFor(result: ActionResult<unknown>, t: ReturnType<typeof useTranslations<'visits'>>): string {
  const code = result.error?.code ?? 'generic';
  const key = (['CONFLICT', 'NOT_FOUND', 'VALIDATION_ERROR'].includes(code) ? code : 'generic') as
    | 'CONFLICT'
    | 'NOT_FOUND'
    | 'VALIDATION_ERROR'
    | 'generic';
  return t(`errors.${key}`);
}

export function VisitsWeekClient(props: VisitsWeekClientProps) {
  const { timezone, weekStart, days, visits, advisors, listings, recentLeads, selectedAdvisor, availabilityLabel } = props;
  const t = useTranslations('visits');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showRescheduled, setShowRescheduled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const weekParts = days[0];
  const prevWeek = formatDateParts(addCalendarDays(weekParts, -7));
  const nextWeek = formatDateParts(addCalendarDays(weekParts, 7));

  function withAdvisor(week: string): string {
    const params = new URLSearchParams({ week });
    if (selectedAdvisor !== 'all') params.set('advisor', selectedAdvisor);
    return `/dashboard/visits?${params.toString()}`;
  }

  const visibleVisits = useMemo(
    () => visits.filter((v) => showRescheduled || v.status !== 'rescheduled'),
    [visits, showRescheduled],
  );

  const visitsByDay = useMemo(() => {
    const map = new Map<string, VisitCardData[]>();
    for (const day of days) map.set(formatDateParts(day), []);
    for (const v of visibleVisits) {
      const local = new Date(v.startsAt).toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA => YYYY-MM-DD
      if (map.has(local)) map.get(local)!.push(v);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [visibleVisits, days, timezone]);

  const summary = useMemo(() => {
    const counts: Record<string, number> = { scheduled: 0, confirmed: 0, completed: 0, no_show: 0, cancelled: 0 };
    for (const v of visits) if (v.status in counts) counts[v.status]++;
    return counts;
  }, [visits]);

  function runAction(promise: Promise<ActionResult<unknown>>) {
    startTransition(() => {
      promise.then((result) => {
        if (result.error) {
          setActionError(errorMessageFor(result, t));
        } else {
          setActionError(null);
          router.refresh();
        }
      });
    });
  }

  function handleAdvisorChange(value: string) {
    const params = new URLSearchParams({ week: weekStart });
    if (value !== 'all') params.set('advisor', value);
    router.push(`/dashboard/visits?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
          <Link href="/dashboard/visits/availability" className="text-sm text-brand-600 hover:underline">
            {availabilityLabel}
          </Link>
        </div>
        <Button onClick={() => setDialogOpen(true)}>{t('newVisit')}</Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex items-center gap-2">
          <Link href={withAdvisor(prevWeek)} className="px-2 py-1 text-sm rounded-md border border-slate-200 hover:bg-slate-50">
            {t('previousWeek')}
          </Link>
          <Link
            href={withAdvisor(formatDateParts(weekParts))}
            className="px-2 py-1 text-sm rounded-md border border-slate-200 hover:bg-slate-50"
          >
            {t('today')}
          </Link>
          <Link href={withAdvisor(nextWeek)} className="px-2 py-1 text-sm rounded-md border border-slate-200 hover:bg-slate-50">
            {t('nextWeek')}
          </Link>
          <span className="text-sm text-slate-500">{weekStart}</span>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            {t('advisorFilter')}
            <select
              value={selectedAdvisor}
              onChange={(e) => handleAdvisorChange(e.target.value)}
              className="px-2 py-1 text-sm border border-slate-200 rounded-md"
            >
              <option value="all">{t('allAdvisors')}</option>
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showRescheduled}
              onChange={(e) => setShowRescheduled(e.target.checked)}
              className="rounded border-slate-300"
            />
            {t('showRescheduled')}
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled'] as const).map((s) => (
          <Badge key={s} variant={STATUS_BADGE_VARIANT[s]}>
            {t(`summary.${s}`)}: {summary[s]}
          </Badge>
        ))}
      </div>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {days.map((day) => {
          const key = formatDateParts(day);
          const dayVisits = visitsByDay.get(key) ?? [];
          return (
            <div key={key} className="bg-white border border-slate-200 rounded-xl p-2 space-y-2 min-h-[8rem]">
              <p className="text-xs font-semibold text-slate-500">{key}</p>
              {dayVisits.length === 0 && <p className="text-xs text-slate-400">{t('noVisitsThisDay')}</p>}
              {dayVisits.map((v) => (
                <div key={v.id} className="border border-slate-200 rounded-lg p-2 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium text-slate-700">
                      {timeLabel(v.startsAt, timezone)}–{timeLabel(v.endsAt, timezone)}
                    </span>
                    <Badge variant={STATUS_BADGE_VARIANT[v.status] ?? 'default'}>{t(`status.${v.status}`)}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 truncate">{v.listingTitle ?? t('withoutListing')}</p>
                  <p className="text-xs text-slate-500 truncate">{v.leadName ?? t('withoutLead')}</p>
                  <p className="text-xs text-slate-400 truncate">{v.advisorName}</p>

                  {ACTIVE_STATUSES.has(v.status) && reschedulingId !== v.id && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {v.status === 'scheduled' && (
                        <button
                          type="button"
                          onClick={() => runAction(confirmVisitStaff({ visitId: v.id }))}
                          className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50"
                        >
                          {t('actions.confirm')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => runAction(markVisitOutcomeAction({ visitId: v.id, outcome: 'completed' }))}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50"
                      >
                        {t('actions.complete')}
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(markVisitOutcomeAction({ visitId: v.id, outcome: 'no_show' }))}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50"
                      >
                        {t('actions.noShow')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReschedulingId(v.id)}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50"
                      >
                        {t('actions.reschedule')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const reason = window.prompt(t('cancelReasonPrompt')) ?? undefined;
                          runAction(cancelVisitStaff({ visitId: v.id, reason }));
                        }}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50"
                      >
                        {t('actions.cancel')}
                      </button>
                    </div>
                  )}

                  {reschedulingId === v.id && (
                    <RescheduleInlineForm
                      visitId={v.id}
                      onCancel={() => setReschedulingId(null)}
                      onSubmit={(date, startMinute) => {
                        runAction(rescheduleVisitStaff({ visitId: v.id, date, startMinute }));
                        setReschedulingId(null);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {dialogOpen && (
        <NewVisitDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            router.refresh();
          }}
          advisors={advisors}
          listings={listings}
          recentLeads={recentLeads}
          defaultDate={weekStart}
        />
      )}
    </div>
  );
}

function RescheduleInlineForm({
  visitId,
  onCancel,
  onSubmit,
}: {
  visitId: string;
  onCancel: () => void;
  onSubmit: (date: string, startMinute: number) => void;
}) {
  const t = useTranslations('visits');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  function handleSubmit() {
    if (!date || !time) return;
    const [h, m] = time.split(':').map(Number);
    onSubmit(date, h * 60 + m);
  }

  return (
    <div className="space-y-1 pt-1" data-testid={`reschedule-form-${visitId}`}>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full text-xs px-1.5 py-1 border border-slate-200 rounded"
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="w-full text-xs px-1.5 py-1 border border-slate-200 rounded"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={handleSubmit}
          className="text-[11px] px-1.5 py-0.5 rounded bg-brand-600 text-white hover:bg-brand-700"
        >
          {t('rescheduleSubmit')}
        </button>
        <button type="button" onClick={onCancel} className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200">
          {t('actions.cancel')}
        </button>
      </div>
    </div>
  );
}
