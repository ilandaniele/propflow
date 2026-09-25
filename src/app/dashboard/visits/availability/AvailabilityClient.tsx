'use client';

/**
 * /dashboard/visits/availability — per-advisor booking settings, weekly
 * availability windows and one-off exceptions. All mutations go through
 * src/app/actions/visit-availability.ts.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import {
  addAvailabilityException,
  deleteAvailabilityException,
  replaceWeeklyWindows,
  saveAdvisorSettings,
} from '@/app/actions/visit-availability';
import type { ActionResult } from '@/lib/errors';

export interface AdvisorOption {
  id: string;
  fullName: string;
}

export interface AdvisorSettingsData {
  profileId: string;
  acceptsVisits: boolean;
  visitMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  daysAhead: number;
  slotStepMinutes: number;
}

export interface WindowData {
  id: string;
  profileId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface ExceptionData {
  id: string;
  profileId: string;
  startsAt: string;
  endsAt: string;
  kind: 'block' | 'extra';
  reason: string | null;
}

export interface AvailabilityClientProps {
  advisors: AdvisorOption[];
  settings: AdvisorSettingsData[];
  windows: WindowData[];
  exceptions: ExceptionData[];
}

const DEFAULT_SETTINGS: Omit<AdvisorSettingsData, 'profileId'> = {
  acceptsVisits: true,
  visitMinutes: 45,
  bufferMinutes: 15,
  minNoticeMinutes: 120,
  daysAhead: 14,
  slotStepMinutes: 30,
};

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function errCode(result: ActionResult<unknown>): 'FORBIDDEN' | 'VALIDATION_ERROR' | 'generic' {
  const code = result.error?.code ?? 'generic';
  return (['FORBIDDEN', 'VALIDATION_ERROR'].includes(code) ? code : 'generic') as 'FORBIDDEN' | 'VALIDATION_ERROR' | 'generic';
}

export function AvailabilityClient({ advisors, settings, windows, exceptions }: AvailabilityClientProps) {
  const t = useTranslations('visitAvailability');
  const [selectedAdvisor, setSelectedAdvisor] = useState(advisors[0]?.id ?? '');

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>

      <label className="block text-sm text-slate-700 space-y-1">
        {t('advisor')}
        <select
          value={selectedAdvisor}
          onChange={(e) => setSelectedAdvisor(e.target.value)}
          className="w-full max-w-sm text-sm px-2 py-1.5 border border-slate-200 rounded-md"
        >
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.fullName}
            </option>
          ))}
        </select>
      </label>

      {selectedAdvisor && (
        <AdvisorPanel
          // Remount on advisor change so form state initializes fresh from
          // props instead of needing a setState-in-effect sync.
          key={selectedAdvisor}
          profileId={selectedAdvisor}
          settings={settings.find((s) => s.profileId === selectedAdvisor) ?? null}
          windows={windows.filter((w) => w.profileId === selectedAdvisor)}
          exceptions={exceptions.filter((e) => e.profileId === selectedAdvisor)}
        />
      )}
    </div>
  );
}

function AdvisorPanel({
  profileId,
  settings,
  windows,
  exceptions,
}: {
  profileId: string;
  settings: AdvisorSettingsData | null;
  windows: WindowData[];
  exceptions: ExceptionData[];
}) {
  const t = useTranslations('visitAvailability');
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [form, setForm] = useState<Omit<AdvisorSettingsData, 'profileId'>>(settings ? { ...settings } : DEFAULT_SETTINGS);
  const [localWindows, setLocalWindows] = useState(
    windows.map((w) => ({ weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute })),
  );
  const [newWindow, setNewWindow] = useState({ weekday: 1, start: '09:00', end: '18:00' });
  const [newException, setNewException] = useState({ date: '', start: '09:00', end: '10:00', kind: 'block' as 'block' | 'extra', reason: '' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingWindows, setSavingWindows] = useState(false);
  const [addingException, setAddingException] = useState(false);

  const sortedExceptions = useMemo(() => [...exceptions].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [exceptions]);

  async function handleSaveSettings() {
    setSavingSettings(true);
    setMessage(null);
    try {
      const result = await saveAdvisorSettings({
        profileId,
        ...form,
        slotStepMinutes: form.slotStepMinutes as 15 | 30 | 60,
      });
      if (result.error) {
        setMessage({ kind: 'error', text: t(`errors.${errCode(result)}`) });
        return;
      }
      setMessage({ kind: 'ok', text: t('savedOk') });
      startTransition(() => router.refresh());
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveWindows() {
    setSavingWindows(true);
    setMessage(null);
    try {
      const result = await replaceWeeklyWindows({ profileId, windows: localWindows });
      if (result.error) {
        setMessage({ kind: 'error', text: t(`errors.${errCode(result)}`) });
        return;
      }
      setMessage({ kind: 'ok', text: t('savedOk') });
      startTransition(() => router.refresh());
    } finally {
      setSavingWindows(false);
    }
  }

  function addWindowLocal() {
    setLocalWindows((prev) => [
      ...prev,
      { weekday: newWindow.weekday, startMinute: timeToMinutes(newWindow.start), endMinute: timeToMinutes(newWindow.end) },
    ]);
  }

  function removeWindowLocal(index: number) {
    setLocalWindows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAddException() {
    if (!newException.date) return;
    setAddingException(true);
    setMessage(null);
    try {
      const result = await addAvailabilityException({
        profileId,
        date: newException.date,
        startMinute: timeToMinutes(newException.start),
        endMinute: timeToMinutes(newException.end),
        kind: newException.kind,
        reason: newException.reason.trim() || undefined,
      });
      if (result.error) {
        setMessage({ kind: 'error', text: t(`errors.${errCode(result)}`) });
        return;
      }
      setNewException({ date: '', start: '09:00', end: '10:00', kind: 'block', reason: '' });
      startTransition(() => router.refresh());
    } finally {
      setAddingException(false);
    }
  }

  async function handleDeleteException(id: string) {
    const result = await deleteAvailabilityException({ id });
    if (result.error) {
      setMessage({ kind: 'error', text: t(`errors.${errCode(result)}`) });
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {message && <p className={`text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-green-600'}`}>{message.text}</p>}

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.acceptsVisits}
            onChange={(e) => setForm((f) => ({ ...f, acceptsVisits: e.target.checked }))}
            className="rounded border-slate-300"
          />
          {t('acceptsVisits')}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="text-sm text-slate-700 space-y-1">
            {t('visitMinutes')}
            <input
              type="number"
              min={10}
              max={240}
              value={form.visitMinutes}
              onChange={(e) => setForm((f) => ({ ...f, visitMinutes: Number(e.target.value) }))}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </label>
          <label className="text-sm text-slate-700 space-y-1">
            {t('bufferMinutes')}
            <input
              type="number"
              min={0}
              max={120}
              value={form.bufferMinutes}
              onChange={(e) => setForm((f) => ({ ...f, bufferMinutes: Number(e.target.value) }))}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </label>
          <label className="text-sm text-slate-700 space-y-1">
            {t('minNoticeMinutes')}
            <input
              type="number"
              min={0}
              value={form.minNoticeMinutes}
              onChange={(e) => setForm((f) => ({ ...f, minNoticeMinutes: Number(e.target.value) }))}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </label>
          <label className="text-sm text-slate-700 space-y-1">
            {t('daysAhead')}
            <input
              type="number"
              min={1}
              max={60}
              value={form.daysAhead}
              onChange={(e) => setForm((f) => ({ ...f, daysAhead: Number(e.target.value) }))}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            />
          </label>
          <label className="text-sm text-slate-700 space-y-1">
            {t('slotStepMinutes')}
            <select
              value={form.slotStepMinutes}
              onChange={(e) => setForm((f) => ({ ...f, slotStepMinutes: Number(e.target.value) }))}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md"
            >
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </label>
        </div>
        <Button onClick={handleSaveSettings} loading={savingSettings}>
          {t('saveSettings')}
        </Button>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">{t('weeklyWindows')}</h2>
        <ul className="space-y-1">
          {localWindows.map((w, i) => (
            <li key={`${w.weekday}-${w.startMinute}-${i}`} className="flex items-center gap-2 text-sm text-slate-700">
              <span className="w-24">{t(`weekday.${w.weekday}`)}</span>
              <span>
                {minutesToTime(w.startMinute)}–{minutesToTime(w.endMinute)}
              </span>
              <button type="button" onClick={() => removeWindowLocal(i)} className="text-xs text-red-600 hover:underline">
                {t('removeWindow')}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600 space-y-1">
            <select
              value={newWindow.weekday}
              onChange={(e) => setNewWindow((w) => ({ ...w, weekday: Number(e.target.value) }))}
              className="text-sm px-2 py-1 border border-slate-200 rounded-md"
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {t(`weekday.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <input
            type="time"
            value={newWindow.start}
            onChange={(e) => setNewWindow((w) => ({ ...w, start: e.target.value }))}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          />
          <input
            type="time"
            value={newWindow.end}
            onChange={(e) => setNewWindow((w) => ({ ...w, end: e.target.value }))}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          />
          <button type="button" onClick={addWindowLocal} className="text-sm px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50">
            {t('addWindow')}
          </button>
        </div>
        <Button onClick={handleSaveWindows} loading={savingWindows}>
          {t('saveWindows')}
        </Button>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">{t('exceptions')}</h2>
        <ul className="space-y-1">
          {sortedExceptions.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-sm text-slate-700">
              <span>{e.kind === 'block' ? t('exceptionBlock') : t('exceptionExtra')}</span>
              <span>
                {new Date(e.startsAt).toLocaleString()} – {new Date(e.endsAt).toLocaleString()}
              </span>
              {e.reason && <span className="text-slate-400">({e.reason})</span>}
              <button type="button" onClick={() => handleDeleteException(e.id)} className="text-xs text-red-600 hover:underline">
                {t('deleteException')}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="date"
            value={newException.date}
            onChange={(e) => setNewException((x) => ({ ...x, date: e.target.value }))}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          />
          <input
            type="time"
            value={newException.start}
            onChange={(e) => setNewException((x) => ({ ...x, start: e.target.value }))}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          />
          <input
            type="time"
            value={newException.end}
            onChange={(e) => setNewException((x) => ({ ...x, end: e.target.value }))}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          />
          <select
            value={newException.kind}
            onChange={(e) => setNewException((x) => ({ ...x, kind: e.target.value as 'block' | 'extra' }))}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          >
            <option value="block">{t('exceptionBlock')}</option>
            <option value="extra">{t('exceptionExtra')}</option>
          </select>
          <input
            type="text"
            placeholder={t('exceptionReason')}
            value={newException.reason}
            onChange={(e) => setNewException((x) => ({ ...x, reason: e.target.value }))}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          />
          <button
            type="button"
            onClick={handleAddException}
            disabled={addingException}
            className="text-sm px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            {t('addException')}
          </button>
        </div>
      </section>
    </>
  );
}
