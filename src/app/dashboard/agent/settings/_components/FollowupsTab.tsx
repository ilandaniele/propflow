'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { FollowupPolicy } from '@/lib/leads/types';
import { saveAgentFollowupPolicy } from '@/app/actions/agent-settings';
import { useSettingsAction } from './useSettingsAction';

const MAX_STEPS = 5;

function minutesToHHMM(m: number): string {
  return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export interface FollowupsTabProps {
  policy: FollowupPolicy;
}

/** The full Phase 6 follow-up policy (steps, send window, listing alerts) — reuses FollowupPolicy from leads/types.ts, does not re-derive it. */
export function FollowupsTab({ policy }: FollowupsTabProps) {
  const t = useTranslations('agentSettings');
  const [enabled, setEnabled] = useState(policy.enabled);
  const [steps, setSteps] = useState(policy.steps);
  const [sendWindow, setSendWindow] = useState(policy.sendWindow);
  const [listingAlerts, setListingAlerts] = useState(policy.listingAlerts);
  const { run, error, saving, savedAt } = useSettingsAction();

  const stepsIncreasing = steps.every((s, i) => i === 0 || s.afterMinutes > steps[i - 1].afterMinutes);

  function save() {
    run(() => saveAgentFollowupPolicy({ enabled, steps, sendWindow, listingAlerts }));
  }

  return (
    <Card padding="md" className="space-y-4">
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-slate-300" />
        Seguimientos automáticos activos
      </label>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-slate-700">Pasos de seguimiento (hasta {MAX_STEPS})</p>
          <Button
            size="sm"
            variant="secondary"
            disabled={steps.length >= MAX_STEPS}
            onClick={() => setSteps([...steps, { afterMinutes: (steps.at(-1)?.afterMinutes ?? 0) + 60, kind: 'text' }])}
          >
            Agregar paso
          </Button>
        </div>
        {!stepsIncreasing && <p className="text-xs text-amber-600 mb-1">Los minutos deben ser crecientes.</p>}
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-md p-2 text-sm">
              <label className="flex items-center gap-1 text-xs text-slate-600">
                Minutos
                <input
                  type="number"
                  min={1}
                  value={step.afterMinutes}
                  onChange={(e) => {
                    const next = [...steps];
                    next[i] = { ...next[i], afterMinutes: Number(e.target.value) || 1 };
                    setSteps(next);
                  }}
                  className="w-20 text-xs px-1 py-0.5 border border-slate-200 rounded-md"
                />
              </label>
              <select
                value={step.kind}
                onChange={(e) => {
                  const next = [...steps];
                  next[i] = { ...next[i], kind: e.target.value as 'text' | 'template' };
                  setSteps(next);
                }}
                className="text-xs px-1 py-0.5 border border-slate-200 rounded-md"
              >
                <option value="text">text</option>
                <option value="template">template</option>
              </select>
              {step.kind === 'template' && (
                <input
                  type="text"
                  placeholder="nombre de plantilla"
                  value={step.template ?? ''}
                  onChange={(e) => {
                    const next = [...steps];
                    next[i] = { ...next[i], template: e.target.value };
                    setSteps(next);
                  }}
                  className="text-xs px-1 py-0.5 border border-slate-200 rounded-md flex-1 min-w-[8rem]"
                />
              )}
              <button
                type="button"
                onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                className="ml-auto text-xs text-red-600 hover:underline"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Ventana de envío
          <input
            type="time"
            value={minutesToHHMM(sendWindow.startMinute)}
            onChange={(e) => setSendWindow({ ...sendWindow, startMinute: hhmmToMinutes(e.target.value) })}
            className="px-2 py-1 border border-slate-200 rounded-md"
          />
          <span className="text-slate-400">–</span>
          <input
            type="time"
            value={minutesToHHMM(sendWindow.endMinute)}
            onChange={(e) => setSendWindow({ ...sendWindow, endMinute: hhmmToMinutes(e.target.value) })}
            className="px-2 py-1 border border-slate-200 rounded-md"
          />
        </label>
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={listingAlerts.enabled}
            onChange={(e) => setListingAlerts({ ...listingAlerts, enabled: e.target.checked })}
            className="rounded border-slate-300"
          />
          Alertas de nuevas propiedades
        </label>
        {listingAlerts.enabled && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input
              label="Días frío"
              type="number"
              min={1}
              value={listingAlerts.coldAfterDays}
              onChange={(e) => setListingAlerts({ ...listingAlerts, coldAfterDays: Number(e.target.value) || 1 })}
            />
            <Input
              label="Días mín. entre envíos"
              type="number"
              min={1}
              value={listingAlerts.minDaysBetween}
              onChange={(e) => setListingAlerts({ ...listingAlerts, minDaysBetween: Number(e.target.value) || 1 })}
            />
            <Input
              label="Tope por corrida"
              type="number"
              min={1}
              value={listingAlerts.maxPerOrgPerRun}
              onChange={(e) => setListingAlerts({ ...listingAlerts, maxPerOrgPerRun: Number(e.target.value) || 1 })}
            />
            <Input
              label="Plantilla"
              value={listingAlerts.template}
              onChange={(e) => setListingAlerts({ ...listingAlerts, template: e.target.value })}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} loading={saving} disabled={!stepsIncreasing}>Guardar</Button>
        {savedAt && !error && <span className="text-xs text-green-600">{t('saved')}</span>}
      </div>
    </Card>
  );
}
