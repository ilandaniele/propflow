'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { commitDataImport, previewDataImport, type DataImportPreview } from '@/app/actions/data-import';
import { DATA_IMPORT_COLUMNS, DATA_IMPORT_KINDS, type DataImportKind } from '@/lib/data-import/schemas';
import type { PlannedStatus } from '@/lib/data-import/plan';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';

const STATUS_VARIANT: Record<PlannedStatus, 'success' | 'default' | 'danger' | 'warning'> = {
  new:              'success',
  duplicate:        'default',
  invalid:          'danger',
  unknown_property: 'warning',
};

export function DataImportForm() {
  const t = useTranslations('dataImport');
  const [kind, setKind] = useState<DataImportKind>('properties');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DataImportPreview | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function formData(): FormData {
    const data = new FormData();
    data.set('kind', kind);
    if (file) data.set('file', file);
    return data;
  }

  function runPreview() {
    setMessage(null);
    startTransition(async () => {
      const result = await previewDataImport({}, formData());
      setPreview(result.data ?? null);
      if (result.error) setMessage({ tone: 'error', text: t('errors.preview') });
    });
  }

  function runCommit() {
    startTransition(async () => {
      const result = await commitDataImport({}, formData());
      if (!result.data) return setMessage({ tone: 'error', text: t('errors.commit') });
      setPreview(null);
      setMessage({ tone: 'ok', text: t('done', { ...result.data }) });
    });
  }

  function reset() {
    setPreview(null);
    setMessage(null);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('kind')}
          value={kind}
          onChange={(event) => { setKind(event.target.value as DataImportKind); reset(); }}
        >
          {DATA_IMPORT_KINDS.map((value) => <option key={value} value={value}>{t(`kinds.${value}`)}</option>)}
        </Select>
        <label className="block text-sm font-medium text-slate-700">
          {t('file')}
          <input
            type="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full text-sm"
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); reset(); }}
          />
        </label>
      </div>
      <p className="text-sm text-slate-500">
        {t('columns')} <code className="rounded bg-slate-100 px-1">{DATA_IMPORT_COLUMNS[kind].join(',')}</code>. {t(`hints.${kind}`)}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={!file || pending} onClick={runPreview}>{t('preview')}</Button>
        <Button type="button" disabled={!preview || preview.counts.new === 0 || pending} onClick={runCommit}>
          {t('commit', { count: preview?.counts.new ?? 0 })}
        </Button>
      </div>
      {message && (
        <p role="status" className={message.tone === 'ok' ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{message.text}</p>
      )}
      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_VARIANT) as PlannedStatus[]).map((status) => (
              <Badge key={status} variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}: {preview.counts[status]}</Badge>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-1 pr-3">{t('row')}</th><th className="py-1 pr-3">{t('record')}</th><th className="py-1">{t('result')}</th></tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-slate-100">
                    <td className="py-1 pr-3 tabular-nums">{row.rowNumber}</td>
                    <td className="py-1 pr-3">{row.label}</td>
                    <td className="py-1">
                      <Badge variant={STATUS_VARIANT[row.status]}>{t(`status.${row.status}`)}</Badge>
                      {row.fields && <span className="ml-2 text-xs text-slate-500">{row.fields.join(', ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
