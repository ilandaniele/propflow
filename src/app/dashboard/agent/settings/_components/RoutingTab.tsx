'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { saveRoutingMode } from '@/app/actions/lead-routing';
import type { RoutingMode } from '@/lib/leads/types';
import { useSettingsAction } from './useSettingsAction';

export interface RoutingTabProps {
  routingMode: RoutingMode;
}

/** Just the mode select — member weights/caps/pipelines stay on /dashboard/leads's LeadSettingsCard (item F), linked below rather than duplicated here. */
export function RoutingTab({ routingMode }: RoutingTabProps) {
  const t = useTranslations('agentSettings');
  const [mode, setMode] = useState(routingMode);
  const { run, error, saving, savedAt } = useSettingsAction();

  return (
    <Card padding="md" className="space-y-3">
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <Select
        label="Modo de enrutamiento"
        value={mode}
        disabled={saving}
        onChange={(e) => {
          const value = e.target.value as RoutingMode;
          setMode(value);
          run(() => saveRoutingMode({ mode: value }));
        }}
      >
        <option value="round_robin">Round robin</option>
        <option value="weighted">Ponderado</option>
        <option value="manual">Manual</option>
      </Select>
      {savedAt && !error && <span className="text-xs text-green-600">{t('saved')}</span>}
      <p className="text-sm text-slate-500">
        Para asignar asesores, pesos y topes por miembro, andá a{' '}
        <Link href="/dashboard/leads" className="text-brand-600 hover:underline">
          Pipeline de leads
        </Link>
        .
      </p>
    </Card>
  );
}
