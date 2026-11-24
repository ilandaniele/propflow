'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createAnnouncement } from '@/app/actions/ops';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const t = useTranslations('forms.announcement');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('saving') : t('submit')}</Button>;
}

interface TargetOption {
  id: string;
  label: string;
}

type Audience = 'all' | 'property' | 'unit';

const selectClass = 'border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function TargetSelect({ name, label, placeholder, options }: { name: string; label: string; placeholder: string; options: TargetOption[] }) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">{label}</label>
      <select id={name} name={name} required defaultValue="" className={selectClass}>
        <option value="" disabled>{placeholder}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </div>
  );
}

export function AnnouncementForm({ properties, units }: { properties: TargetOption[]; units: TargetOption[] }) {
  const t = useTranslations('forms.announcement');
  const [state, action] = useActionState<ActionResult, FormData>(createAnnouncement, {});
  const [audience, setAudience] = useState<Audience>('all');

  return (
    <form action={action} className="space-y-4">
      <Input label={t('titleLabel')} name="title" required placeholder={t('titlePlaceholder')} />
      <div className="space-y-1">
        <label htmlFor="body" className="block text-sm font-medium text-slate-700">{t('bodyLabel')}</label>
        <textarea
          id="body"
          name="body"
          required
          rows={4}
          placeholder={t('bodyPlaceholder')}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="audience" className="block text-sm font-medium text-slate-700">{t('audienceLabel')}</label>
        <select
          id="audience"
          name="audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value as Audience)}
          className={selectClass}
        >
          <option value="all">{t('audienceAll')}</option>
          <option value="property">{t('audienceProperty')}</option>
          <option value="unit">{t('audienceUnit')}</option>
        </select>
      </div>
      {audience === 'property' && (
        <TargetSelect name="property_id" label={t('propertyLabel')} placeholder={t('choosePlaceholder')} options={properties} />
      )}
      {audience === 'unit' && (
        <TargetSelect name="unit_id" label={t('unitLabel')} placeholder={t('choosePlaceholder')} options={units} />
      )}
      <div className="flex flex-wrap gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="pinned" className="rounded border-slate-300" />
          {t('pinnedLabel')}
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="important" className="rounded border-slate-300" />
          {t('importantLabel')}
        </label>
      </div>
      <SubmitButton />
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
