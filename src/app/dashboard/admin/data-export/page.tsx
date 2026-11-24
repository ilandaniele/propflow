import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = { title: 'Exportar datos' };

export default async function DataExportPage() {
  try { await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('dataExport');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <p className="text-sm text-slate-600">{t('privacy')}</p>
        <p className="text-sm text-slate-500 mt-2">{t('limit')}</p>
        <a
          href="/api/admin/data-export"
          download
          className="mt-4 inline-flex h-9 items-center rounded bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-700"
        >
          {t('button')}
        </a>
      </Card>
    </div>
  );
}
