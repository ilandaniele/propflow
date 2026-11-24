import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { StaffDirectory } from '@/components/staff/StaffDirectory';
import { listStaffDirectory } from '@/lib/staff/queries';

export default async function PortalStaffPage() {
  const ctx = await requireTenant();
  const t = await getTranslations('staff');
  const staff = await listStaffDirectory(ctx.orgId);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500">{t('portalSubtitle')}</p>
      </div>
      <Card padding="md">
        <StaffDirectory rows={staff} />
      </Card>
    </div>
  );
}
