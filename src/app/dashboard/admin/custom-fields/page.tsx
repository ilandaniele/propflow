import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { listDefinitions } from '@/lib/custom-fields/queries';
import { CUSTOM_FIELD_ENTITY_TYPES } from '@/lib/custom-fields/schemas';
import { CreateDefinitionForm } from './CreateDefinitionForm';
import { DefinitionRow } from './DefinitionRow';

export const metadata: Metadata = { title: 'Custom fields' };

export default async function AdminCustomFieldsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [t, definitions] = await Promise.all([getTranslations('customFields'), listDefinitions(ctx.orgId)]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('newField')}</h2>
        <CreateDefinitionForm />
      </Card>

      {CUSTOM_FIELD_ENTITY_TYPES.map((entityType) => {
        const rows = definitions.filter((d) => d.entityType === entityType);
        return (
          <Card key={entityType} padding="md">
            <h2 className="text-base font-medium text-slate-800 mb-2">{t(`entity.${entityType}`)}</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">{t('emptyEntity')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((definition) => <DefinitionRow key={definition.id} definition={definition} />)}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
