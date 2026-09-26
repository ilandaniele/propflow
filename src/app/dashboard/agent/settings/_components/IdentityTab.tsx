'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { saveAgentIdentity } from '@/app/actions/agent-settings';
import { useSettingsAction } from './useSettingsAction';

export interface IdentityTabProps {
  persona: string;
  tone: 'profesional' | 'cercano' | 'formal';
  timezone: string;
}

export function IdentityTab({ persona, tone, timezone }: IdentityTabProps) {
  const t = useTranslations('agentSettings');
  const [form, setForm] = useState({ persona, tone, timezone });
  const { run, error, saving, savedAt } = useSettingsAction();

  return (
    <Card padding="md" className="space-y-3">
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <Input
        label={t('persona')}
        value={form.persona}
        onChange={(e) => setForm({ ...form, persona: e.target.value })}
        maxLength={60}
      />
      <Select
        label={t('tone')}
        value={form.tone}
        onChange={(e) => setForm({ ...form, tone: e.target.value as IdentityTabProps['tone'] })}
      >
        <option value="profesional">Profesional</option>
        <option value="cercano">Cercano</option>
        <option value="formal">Formal</option>
      </Select>
      <Input
        label={t('timezone')}
        value={form.timezone}
        onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        hint="Ej. America/Lima"
      />
      <div className="flex items-center gap-3">
        <Button
          onClick={() => run(() => saveAgentIdentity(form))}
          loading={saving}
          disabled={form.persona.trim().length < 2}
        >
          Guardar
        </Button>
        {savedAt && !error && <span className="text-xs text-green-600">{t('saved')}</span>}
      </div>
    </Card>
  );
}
