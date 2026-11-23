import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { properties } from '@/lib/db/schema';
import { Card } from '@/components/ui/Card';
import { RemoveStaffButton } from '@/components/staff/RemoveStaffButton';
import { StaffDirectory } from '@/components/staff/StaffDirectory';
import { StaffForm } from '@/components/staff/StaffForm';
import { listStaff } from '@/lib/staff/queries';

export default async function AdminStaffPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('staff');

  const [staff, propertyOptions] = await Promise.all([
    listStaff(ctx.orgId),
    db.select({ id: properties.id, name: properties.name }).from(properties)
      .where(eq(properties.orgId, ctx.orgId)).orderBy(asc(properties.name)),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500">{t('adminSubtitle')}</p>
      </div>
      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('addTitle')}</h2>
        <StaffForm properties={propertyOptions} />
      </Card>
      <Card padding="md">
        <StaffDirectory rows={staff} renderAction={(id) => <RemoveStaffButton id={id} />} />
      </Card>
    </div>
  );
}
