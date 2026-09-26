'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import type { VoiceConfig } from '@/lib/agent/config-schema';
import type { VoiceChannel } from '@/lib/agent/voice/types';
import { saveAgentVoiceConfig, addDoNotCallNumber, removeDoNotCallNumber } from '@/app/actions/agent-settings';
import { useSettingsAction } from './useSettingsAction';

function minutesToHHMM(m: number): string {
  return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export interface VoiceTabProps {
  voice: VoiceConfig;
  voiceChannel: VoiceChannel | null;
  monthlyUsage: { usedMinutes: number; inFlightCalls: number };
  dncItems: Array<{ phoneE164: string; source: 'staff' | 'caller_request'; reason: string | null; createdAt: Date | string }>;
  dncTotal: number;
  dncPage: number;
  dncQuery: string;
}

export function VoiceTab({ voice, voiceChannel, monthlyUsage, dncItems, dncTotal, dncPage, dncQuery }: VoiceTabProps) {
  const t = useTranslations('agentSettings');
  const [form, setForm] = useState<VoiceConfig>(voice);
  const { run, error, saving, savedAt } = useSettingsAction();

  function save() {
    run(() => saveAgentVoiceConfig(form));
  }

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-1">
        <p className="text-sm font-medium text-slate-700">{t('voiceNumber')}</p>
        {voiceChannel?.displayPhoneE164 ? (
          <p className="text-sm text-slate-900">{voiceChannel.displayPhoneE164}</p>
        ) : (
          <p className="text-sm text-amber-600">{t('voiceNumberMissing')}</p>
        )}
        <p className="text-xs text-slate-500">
          Uso del mes: {monthlyUsage.usedMinutes} min usados, {monthlyUsage.inFlightCalls} llamadas en curso.
        </p>
      </Card>

      <Card padding="md" className="space-y-3">
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Proveedor de voz"
            value={form.voiceProvider}
            onChange={(e) => setForm({ ...form, voiceProvider: e.target.value as VoiceConfig['voiceProvider'] })}
          >
            <option value="azure">Azure</option>
            <option value="11labs">11Labs</option>
            <option value="openai">OpenAI</option>
          </Select>
          <Input
            label="Id. de voz"
            value={form.voiceId}
            maxLength={80}
            onChange={(e) => setForm({ ...form, voiceId: e.target.value })}
          />
          <Select
            label="Idioma"
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value as VoiceConfig['language'] })}
          >
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="pt">Português</option>
          </Select>
          <Input
            label={t('maxCallMinutes')}
            type="number"
            min={1}
            max={30}
            value={form.maxCallMinutes}
            onChange={(e) => setForm({ ...form, maxCallMinutes: Number(e.target.value) || 1 })}
          />
          <Input
            label={t('monthlyCap')}
            type="number"
            min={0}
            max={100_000}
            value={form.monthlyMinuteCap}
            onChange={(e) => setForm({ ...form, monthlyMinuteCap: Number(e.target.value) || 0 })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.recordingEnabled}
            onChange={(e) => setForm({ ...form, recordingEnabled: e.target.checked })}
            className="rounded border-slate-300"
          />
          {t('recording')}
        </label>

        <Input
          label="Saludo adicional"
          value={form.greetingExtra ?? ''}
          maxLength={200}
          onChange={(e) => setForm({ ...form, greetingExtra: e.target.value || null })}
        />

        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">{t('callWindow')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {WEEKDAY_LABELS.map((label, i) => {
                const weekday = i + 1;
                const active = form.callWindow.weekdays.includes(weekday);
                return (
                  <button
                    key={weekday}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        callWindow: {
                          ...form.callWindow,
                          weekdays: active
                            ? form.callWindow.weekdays.filter((d) => d !== weekday)
                            : [...form.callWindow.weekdays, weekday].sort(),
                        },
                      })
                    }
                    className={`px-2 py-1 text-xs rounded-md border ${
                      active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <input
              type="time"
              value={minutesToHHMM(form.callWindow.startMinute)}
              onChange={(e) => setForm({ ...form, callWindow: { ...form.callWindow, startMinute: hhmmToMinutes(e.target.value) } })}
              className="px-2 py-1 border border-slate-200 rounded-md"
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              value={minutesToHHMM(form.callWindow.endMinute)}
              onChange={(e) => setForm({ ...form, callWindow: { ...form.callWindow, endMinute: hhmmToMinutes(e.target.value) } })}
              className="px-2 py-1 border border-slate-200 rounded-md"
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">Se aplica un límite duro de 08:00–21:00 hora local, aunque se configure otra cosa.</p>
        </div>

        <div className="border-t border-slate-100 pt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.speedToLead.enabled}
              onChange={(e) => setForm({ ...form, speedToLead: { ...form.speedToLead, enabled: e.target.checked } })}
              className="rounded border-slate-300"
            />
            {t('speedToLead')}
          </label>
          {form.speedToLead.enabled && (
            <Input
              label="Minutos de espera"
              type="number"
              min={1}
              max={60}
              value={form.speedToLead.delayMinutes}
              onChange={(e) => setForm({ ...form, speedToLead: { ...form.speedToLead, delayMinutes: Number(e.target.value) || 1 } })}
            />
          )}
        </div>

        <div className="border-t border-slate-100 pt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.visitConfirmation.enabled}
              onChange={(e) => setForm({ ...form, visitConfirmation: { ...form.visitConfirmation, enabled: e.target.checked } })}
              className="rounded border-slate-300"
            />
            {t('visitConfirmation')}
          </label>
          {form.visitConfirmation.enabled && (
            <Input
              label="Horas de anticipación"
              type="number"
              min={4}
              max={48}
              value={form.visitConfirmation.hoursBefore}
              onChange={(e) =>
                setForm({ ...form, visitConfirmation: { ...form.visitConfirmation, hoursBefore: Number(e.target.value) || 4 } })
              }
            />
          )}
        </div>

        <div className="border-t border-slate-100 pt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.reactivation.enabled}
              onChange={(e) => setForm({ ...form, reactivation: { ...form.reactivation, enabled: e.target.checked } })}
              className="rounded border-slate-300"
            />
            {t('reactivation')}
          </label>
          {form.reactivation.enabled && (
            <div className="grid grid-cols-3 gap-2">
              <Input
                label="Días frío"
                type="number"
                min={1}
                value={form.reactivation.coldAfterDays}
                onChange={(e) => setForm({ ...form, reactivation: { ...form.reactivation, coldAfterDays: Number(e.target.value) || 1 } })}
              />
              <Input
                label="Días entre llamadas"
                type="number"
                min={1}
                value={form.reactivation.minDaysBetween}
                onChange={(e) => setForm({ ...form, reactivation: { ...form.reactivation, minDaysBetween: Number(e.target.value) || 1 } })}
              />
              <Input
                label="Tope por corrida"
                type="number"
                min={1}
                max={200}
                value={form.reactivation.maxPerRun}
                onChange={(e) => setForm({ ...form, reactivation: { ...form.reactivation, maxPerRun: Number(e.target.value) || 1 } })}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} loading={saving}>Guardar</Button>
          {savedAt && !error && <span className="text-xs text-green-600">{t('saved')}</span>}
        </div>
      </Card>

      <DncSection items={dncItems} total={dncTotal} page={dncPage} query={dncQuery} />
    </div>
  );
}

function DncSection({
  items,
  total,
  page,
  query,
}: {
  items: VoiceTabProps['dncItems'];
  total: number;
  page: number;
  query: string;
}) {
  const t = useTranslations('agentSettings');
  const router = useRouter();
  const [q, setQ] = useState(query);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const { run, error, saving } = useSettingsAction();
  const pageCount = Math.max(1, Math.ceil(total / 50));

  function goTo(nextPage: number, nextQuery: string) {
    const params = new URLSearchParams();
    if (nextQuery) params.set('dncQ', nextQuery);
    if (nextPage > 1) params.set('dncPage', String(nextPage));
    router.push(`/dashboard/agent/settings?${params.toString()}#voice`);
  }

  return (
    <Card padding="md" className="space-y-3">
      <p className="text-sm font-medium text-slate-700">{t('dnc')}</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <Input label="Teléfono" placeholder="+51987654321" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label="Motivo (opcional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        <Button
          size="sm"
          loading={saving}
          disabled={!phone.trim()}
          onClick={() =>
            run(() => addDoNotCallNumber({ phone, reason: reason.trim() || undefined })).then(() => {
              setPhone('');
              setReason('');
            })
          }
        >
          {t('addNumber')}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button size="sm" variant="secondary" onClick={() => goTo(1, q)}>Buscar</Button>
      </div>

      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Sin números registrados.</p>
        ) : (
          items.map((item) => (
            <div key={item.phoneE164} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 min-w-0 truncate">
                {item.phoneE164}
                {item.reason && <span className="text-slate-400"> — {item.reason}</span>}
              </span>
              {item.source === 'caller_request' ? (
                <span className="text-xs text-slate-400" title={t('protectedEntry')}>{t('protectedEntry')}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => run(() => removeDoNotCallNumber({ phone: item.phoneE164 }))}
                  className="text-xs text-red-600 hover:underline shrink-0"
                >
                  Eliminar
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button disabled={page <= 1} onClick={() => goTo(page - 1, query)} className="disabled:opacity-40">
            ← Anterior
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button disabled={page >= pageCount} onClick={() => goTo(page + 1, query)} className="disabled:opacity-40">
            Siguiente →
          </button>
        </div>
      )}
    </Card>
  );
}
