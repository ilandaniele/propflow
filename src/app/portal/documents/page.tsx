import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { findTenantIdForUser, listTenantPortalDocuments } from '@/lib/documents/queries';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { DocumentList } from '@/components/documents/DocumentList';

export const metadata: Metadata = { title: 'My Documents' };

export default async function PortalDocumentsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const [tenantId, t] = await Promise.all([findTenantIdForUser(ctx.orgId, ctx.userId), getTranslations('documents')]);
  if (!tenantId) {
    return <Card><EmptyState title={t('portal.noTenant')} description={t('portal.noTenantHint')} /></Card>;
  }

  const documents = await listTenantPortalDocuments(ctx.orgId, tenantId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">{t('portal.title')}</h1>
      <Card>
        <DocumentList documents={documents} mode="portal" today={today} />
      </Card>
    </div>
  );
}
