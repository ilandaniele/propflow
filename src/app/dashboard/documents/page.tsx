import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listEntityOptions, listOrgDocuments } from '@/lib/documents/queries';
import { DocumentFilterSchema } from '@/lib/schemas/documents';
import { DOCUMENT_ENTITIES } from '@/lib/documents/types';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploadForm } from './DocumentUploadForm';

export const metadata: Metadata = { title: 'Documents' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function filterClass(active: boolean): string {
  return active
    ? 'rounded-full bg-brand-600 px-3 py-1 text-white'
    : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50';
}

export default async function DocumentsPage({ searchParams }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const filter = DocumentFilterSchema.parse(await searchParams);
  const today = new Date().toISOString().slice(0, 10);
  const [documents, options, t] = await Promise.all([
    listOrgDocuments(ctx.orgId, { entity: filter.entity, expiring: filter.expiring === '1' }, today),
    listEntityOptions(ctx.orgId),
    getTranslations('documents'),
  ]);

  const links = [
    { key: 'all', href: '/dashboard/documents', active: !filter.entity && !filter.expiring, label: t('filters.all') },
    ...DOCUMENT_ENTITIES.map((entity) => ({
      key:    entity,
      href:   `/dashboard/documents?entity=${entity}`,
      active: filter.entity === entity,
      label:  t(`entities.${entity}`),
    })),
    { key: 'expiring', href: '/dashboard/documents?expiring=1', active: filter.expiring === '1', label: t('filters.expiring') },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
      <Card>
        <CardHeader><CardTitle>{t('form.title')}</CardTitle></CardHeader>
        <DocumentUploadForm options={options} />
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('list.title')}</CardTitle></CardHeader>
        <nav aria-label={t('filters.label')} className="mb-3 flex flex-wrap gap-2 text-sm">
          {links.map((link) => (
            <Link key={link.key} href={link.href} className={filterClass(link.active)} aria-current={link.active ? 'page' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <DocumentList documents={documents} mode="admin" today={today} />
      </Card>
    </div>
  );
}
