import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts, tenants } from '@/lib/db/schema';
import { PaymentsClient } from './PaymentsClient';
import { RecordPaymentForm } from './RecordPaymentForm';

export const metadata: Metadata = { title: 'Mis Pagos' };

export default async function PortalPaymentsPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const [activeContract] = await db
    .select({ id: contracts.id, monthlyRent: contracts.monthlyRent })
    .from(contracts)
    .innerJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
    .where(and(
      eq(contracts.orgId, ctx.orgId),
      eq(contracts.status, 'active'),
      eq(tenants.profileId, ctx.userId),
    ))
    .orderBy(desc(contracts.startDate))
    .limit(1);

  return (
    <div className="space-y-6">
      {activeContract && (
        <RecordPaymentForm contractId={activeContract.id} monthlyRent={Number(activeContract.monthlyRent)} />
      )}
      <PaymentsClient />
    </div>
  );
}
