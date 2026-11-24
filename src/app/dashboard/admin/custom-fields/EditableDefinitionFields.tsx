'use client';

import { useTranslations } from 'next-intl';
import { Input, Textarea } from '@/components/ui/Input';

type Props = {
  idPrefix: string;
  showOptions: boolean;
  defaults?: { label: string; sortOrder: number; required: boolean; options: string[] | null };
};

export function EditableDefinitionFields({ idPrefix, showOptions, defaults }: Props) {
  const t = useTranslations('customFields');
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <Input id={`${idPrefix}_label`} label={t('label')} name="label" required maxLength={80} defaultValue={defaults?.label} />
        </div>
        <Input id={`${idPrefix}_sort`} label={t('sortOrder')} name="sort_order" type="number" min={0} max={999} defaultValue={defaults?.sortOrder ?? 0} />
      </div>
      {showOptions && (
        <Textarea
          id={`${idPrefix}_options`}
          label={t('options')}
          name="options"
          hint={t('optionsHint')}
          required
          defaultValue={defaults?.options?.join('\n')}
        />
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="required" defaultChecked={defaults?.required} className="rounded border-slate-300" />
        {t('required')}
      </label>
    </>
  );
}
