import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataImportForm } from './DataImportForm';

export const metadata: Metadata = { title: 'Import from other software' };

export default async function DataImportPage() {
  const t = await getTranslations('dataImport');
  return (
    <Card>
      <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
      <p className="mb-4 text-sm text-slate-500">{t('description')}</p>
      <DataImportForm />
    </Card>
  );
}
