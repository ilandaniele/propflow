'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea, Input } from '@/components/ui/Input';
import { QUALIFICATION_FIELDS, type QualificationField } from '@/lib/agent/config-schema';
import { saveAgentKnowledge } from '@/app/actions/agent-settings';
import { useSettingsAction } from './useSettingsAction';

const FIELD_LABELS: Record<QualificationField, string> = {
  operation_type: 'Tipo de operación (venta/alquiler)',
  zones: 'Zonas de interés',
  budget_min: 'Presupuesto mínimo',
  budget_max: 'Presupuesto máximo',
  bedrooms_min: 'Dormitorios mínimos',
  move_in_date: 'Fecha de mudanza',
  timeline: 'Urgencia',
  pets: 'Mascotas',
  full_name: 'Nombre completo',
};

export interface KnowledgeTabProps {
  rules: string | null;
  prohibited: string | null;
  faq: Array<{ question: string; answer: string }>;
  qualificationFields: string[];
}

const MAX_FAQ = 50;

export function KnowledgeTab({ rules, prohibited, faq, qualificationFields }: KnowledgeTabProps) {
  const t = useTranslations('agentSettings');
  const [rulesText, setRulesText] = useState(rules ?? '');
  const [prohibitedText, setProhibitedText] = useState(prohibited ?? '');
  const [faqItems, setFaqItems] = useState(faq);
  const [fields, setFields] = useState<Set<QualificationField>>(
    new Set(qualificationFields.filter((f): f is QualificationField => (QUALIFICATION_FIELDS as readonly string[]).includes(f)))
  );
  const { run, error, saving, savedAt } = useSettingsAction();

  function toggleField(field: QualificationField) {
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function save() {
    run(() =>
      saveAgentKnowledge({
        rules: rulesText.trim() || null,
        prohibited: prohibitedText.trim() || null,
        faq: faqItems,
        qualificationFields: [...fields],
      })
    );
  }

  return (
    <Card padding="md" className="space-y-4">
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <Textarea
        label={t('rules')}
        value={rulesText}
        onChange={(e) => setRulesText(e.target.value)}
        maxLength={4000}
        rows={4}
      />
      <Textarea
        label={t('prohibited')}
        value={prohibitedText}
        onChange={(e) => setProhibitedText(e.target.value)}
        maxLength={2000}
        rows={3}
      />

      <div>
        <p className="block text-sm font-medium text-slate-700 mb-2">{t('qualificationFields')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {QUALIFICATION_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={fields.has(field)}
                onChange={() => toggleField(field)}
                className="rounded border-slate-300"
              />
              {FIELD_LABELS[field]}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-slate-700">{t('faq')}</p>
          <Button
            size="sm"
            variant="secondary"
            disabled={faqItems.length >= MAX_FAQ}
            onClick={() => setFaqItems([...faqItems, { question: '', answer: '' }])}
          >
            {t('addFaq')}
          </Button>
        </div>
        <div className="space-y-2">
          {faqItems.map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-lg p-2 space-y-1.5">
              <Input
                placeholder={t('question')}
                value={item.question}
                maxLength={300}
                onChange={(e) => {
                  const next = [...faqItems];
                  next[i] = { ...next[i], question: e.target.value };
                  setFaqItems(next);
                }}
              />
              <Textarea
                placeholder={t('answer')}
                value={item.answer}
                maxLength={1000}
                rows={2}
                onChange={(e) => {
                  const next = [...faqItems];
                  next[i] = { ...next[i], answer: e.target.value };
                  setFaqItems(next);
                }}
              />
              <button
                type="button"
                onClick={() => setFaqItems(faqItems.filter((_, idx) => idx !== i))}
                className="text-xs text-red-600 hover:underline"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} loading={saving} disabled={fields.size === 0}>Guardar</Button>
        {savedAt && !error && <span className="text-xs text-green-600">{t('saved')}</span>}
      </div>
    </Card>
  );
}
