'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import type { BusinessHours, WeeklyRange } from '@/lib/agent/config-schema';
import { saveAgentBusinessHours } from '@/app/actions/agent-settings';
import { useSettingsAction } from './useSettingsAction';

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${h}:${mm}`;
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export interface HoursTabProps {
  businessHours: BusinessHours;
}

interface DayRow {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
}

export function HoursTab({ businessHours }: HoursTabProps) {
  const t = useTranslations('agentSettings');
  const [days, setDays] = useState<DayRow[]>(() =>
    Array.from({ length: 7 }, (_, weekday) => {
      const existing = businessHours.weekly.find((r) => r.weekday === weekday);
      return existing
        ? { enabled: true, startMinute: existing.startMinute, endMinute: existing.endMinute }
        : { enabled: false, startMinute: 540, endMinute: 1140 };
    })
  );
  const [closedNote, setClosedNote] = useState(businessHours.closedNote ?? '');
  const { run, error, saving, savedAt } = useSettingsAction();

  function save() {
    const weekly: WeeklyRange[] = days
      .map((d, weekday) => ({ weekday, ...d }))
      .filter((d) => d.enabled)
      .map((d) => ({ weekday: d.weekday, startMinute: d.startMinute, endMinute: d.endMinute }));

    run(() => saveAgentBusinessHours({ weekly, closedNote: closedNote.trim() || null }));
  }

  return (
    <Card padding="md" className="space-y-4">
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <p className="text-sm font-medium text-slate-700">{t('businessHours')}</p>
      <div className="space-y-2">
        {days.map((day, weekday) => (
          <div key={weekday} className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 w-32 shrink-0">
              <input
                type="checkbox"
                checked={day.enabled}
                onChange={(e) => {
                  const next = [...days];
                  next[weekday] = { ...next[weekday], enabled: e.target.checked };
                  setDays(next);
                }}
                className="rounded border-slate-300"
              />
              {WEEKDAY_LABELS[weekday]}
            </label>
            <input
              type="time"
              disabled={!day.enabled}
              value={minutesToHHMM(day.startMinute)}
              onChange={(e) => {
                const next = [...days];
                next[weekday] = { ...next[weekday], startMinute: hhmmToMinutes(e.target.value) };
                setDays(next);
              }}
              className="px-2 py-1 border border-slate-200 rounded-md disabled:opacity-50"
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              disabled={!day.enabled}
              value={minutesToHHMM(day.endMinute)}
              onChange={(e) => {
                const next = [...days];
                next[weekday] = { ...next[weekday], endMinute: hhmmToMinutes(e.target.value) };
                setDays(next);
              }}
              className="px-2 py-1 border border-slate-200 rounded-md disabled:opacity-50"
            />
          </div>
        ))}
      </div>
      <Textarea
        label={t('closedNote')}
        value={closedNote}
        onChange={(e) => setClosedNote(e.target.value)}
        maxLength={300}
        rows={2}
      />
      <div className="flex items-center gap-3">
        <Button onClick={save} loading={saving}>Guardar</Button>
        {savedAt && !error && <span className="text-xs text-green-600">{t('saved')}</span>}
      </div>
    </Card>
  );
}
