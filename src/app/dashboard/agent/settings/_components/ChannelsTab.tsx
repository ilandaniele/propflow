'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { saveAgentLimits } from '@/app/actions/agent-settings';
import { useSettingsAction } from './useSettingsAction';

export interface ChannelsTabProps {
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  dailyTokenBudget: number;
  shadowMode: boolean;
  maxAgentTurns: number | null;
  maxActiveVisitsPerPhone: number;
  maxListingPhotos: number;
  hasVoiceNumber: boolean;
}

/** Canales y límites. The web channel (widget on/off, origins) stays on /dashboard/agent/widget — linked, not duplicated. */
export function ChannelsTab(props: ChannelsTabProps) {
  const t = useTranslations('agentSettings');
  const [form, setForm] = useState({
    whatsappEnabled: props.whatsappEnabled,
    voiceEnabled: props.voiceEnabled,
    dailyTokenBudget: props.dailyTokenBudget,
    shadowMode: props.shadowMode,
    maxAgentTurns: props.maxAgentTurns,
    maxActiveVisitsPerPhone: props.maxActiveVisitsPerPhone,
    maxListingPhotos: props.maxListingPhotos,
  });
  const { run, error, saving, savedAt } = useSettingsAction();

  function save() {
    run(() => saveAgentLimits(form));
  }

  return (
    <Card padding="md" className="space-y-3">
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.whatsappEnabled}
          onChange={(e) => setForm({ ...form, whatsappEnabled: e.target.checked })}
          className="rounded border-slate-300"
        />
        WhatsApp
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.voiceEnabled}
          disabled={!props.hasVoiceNumber && !form.voiceEnabled}
          onChange={(e) => setForm({ ...form, voiceEnabled: e.target.checked })}
          className="rounded border-slate-300"
        />
        Voz
      </label>
      {!props.hasVoiceNumber && <p className="text-xs text-amber-600">{t('voiceNumberMissing')}</p>}

      <p className="text-sm text-slate-500">
        El canal web (widget, orígenes permitidos) se administra en{' '}
        <Link href="/dashboard/agent/widget" className="text-brand-600 hover:underline">
          Widget
        </Link>
        .
      </p>

      <Input
        label={t('dailyBudget')}
        type="number"
        min={1000}
        max={5_000_000}
        value={form.dailyTokenBudget}
        onChange={(e) => setForm({ ...form, dailyTokenBudget: Number(e.target.value) || 1000 })}
      />

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.shadowMode}
          onChange={(e) => setForm({ ...form, shadowMode: e.target.checked })}
          className="rounded border-slate-300"
        />
        {t('shadowMode')}
      </label>

      <Input
        label={t('maxTurns')}
        type="number"
        min={1}
        max={200}
        value={form.maxAgentTurns ?? ''}
        placeholder="Sin límite"
        onChange={(e) => setForm({ ...form, maxAgentTurns: e.target.value ? Number(e.target.value) : null })}
      />

      <Input
        label={t('maxVisitsPerPhone')}
        type="number"
        min={1}
        max={10}
        value={form.maxActiveVisitsPerPhone}
        onChange={(e) => setForm({ ...form, maxActiveVisitsPerPhone: Number(e.target.value) || 1 })}
      />

      <Input
        label={t('maxPhotos')}
        type="number"
        min={1}
        max={10}
        value={form.maxListingPhotos}
        onChange={(e) => setForm({ ...form, maxListingPhotos: Number(e.target.value) || 1 })}
      />

      <div className="flex items-center gap-3">
        <Button onClick={save} loading={saving}>Guardar</Button>
        {savedAt && !error && <span className="text-xs text-green-600">{t('saved')}</span>}
      </div>
    </Card>
  );
}
