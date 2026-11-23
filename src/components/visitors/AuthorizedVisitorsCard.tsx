import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { AuthorizedVisitorForm } from './AuthorizedVisitorForm';
import { AuthorizedVisitorList, type AuthorizedVisitorRow } from './AuthorizedVisitorList';

type Props = {
  rows: AuthorizedVisitorRow[];
  units?: Array<{ id: string; label: string }>;
};

export async function AuthorizedVisitorsCard({ rows, units }: Props) {
  const t = await getTranslations('visitorAccess');
  const isAdmin = units !== undefined;
  return (
    <Card padding="md" className="space-y-4">
      <div>
        <h2 className="text-base font-medium text-slate-800">{t('authorizedTitle')}</h2>
        <p className="text-sm text-slate-500">{isAdmin ? t('authorizedAdminDesc') : t('authorizedPortalDesc')}</p>
      </div>
      <AuthorizedVisitorForm units={units} />
      <AuthorizedVisitorList rows={rows} showUnit={isAdmin} />
    </Card>
  );
}
