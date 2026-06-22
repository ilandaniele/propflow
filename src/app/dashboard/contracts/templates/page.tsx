import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contractTemplates } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ContractTemplateForm } from './ContractTemplateForm';
import { ALLOWED_VARIABLES } from '@/lib/contracts/pdf.tsx';

export default async function ContractTemplatesPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('contractTemplates');

  const templates = await db
    .select({
      id:           contractTemplates.id,
      name:         contractTemplates.name,
      bodyMarkdown: contractTemplates.bodyMarkdown,
      variables:    contractTemplates.variables,
      createdAt:    contractTemplates.createdAt,
    })
    .from(contractTemplates)
    .where(eq(contractTemplates.orgId, ctx.orgId))
    .orderBy(asc(contractTemplates.name));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <CardHeader><CardTitle>{t('cardVariables')}</CardTitle></CardHeader>
        <p className="text-xs text-slate-500 mb-2">{t('variablesNote')}</p>
        <div className="flex flex-wrap gap-2">
          {ALLOWED_VARIABLES.map(v => (
            <code key={v} className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">{`{{${v}}}`}</code>
          ))}
        </div>
      </Card>

      <Card padding="md">
        <CardHeader><CardTitle>{t('cardNewTemplate')}</CardTitle></CardHeader>
        <ContractTemplateForm />
      </Card>

      {templates.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <div className="space-y-3">
          {templates.map((tmpl) => (
            <Card key={tmpl.id} padding="md">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-slate-900">{tmpl.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{tmpl.bodyMarkdown.slice(0, 200)}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
