import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { listEntityFieldValues } from '@/lib/custom-fields/queries';
import type { CustomFieldEntityType } from '@/lib/custom-fields/schemas';
import { CustomFieldsForm } from './CustomFieldsForm';

type Props = { orgId: string; entityType: CustomFieldEntityType; entityId: string };

export async function CustomFieldsCard({ orgId, entityType, entityId }: Props) {
  const [t, fields] = await Promise.all([
    getTranslations('customFields'),
    listEntityFieldValues(orgId, entityType, entityId),
  ]);

  return (
    <Card>
      <CardHeader><CardTitle>{t('cardTitle')}</CardTitle></CardHeader>
      {fields.length === 0 ? (
        <p className="text-sm text-slate-500">
          {t('cardEmpty')}{' '}
          <Link href="/dashboard/admin/custom-fields" className="text-brand-600 hover:underline">{t('manageLink')}</Link>
        </p>
      ) : (
        <CustomFieldsForm entityType={entityType} entityId={entityId} fields={fields} />
      )}
    </Card>
  );
}
