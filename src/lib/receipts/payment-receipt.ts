import { and, eq, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { toBrandingDto } from '@/lib/branding/org-branding';
import { contracts, organizations, orgBranding, payments, properties, tenants, units } from '@/lib/db/schema';

export interface PaymentReceipt {
  number: string;
  orgName: string;
  tenantName: string;
  propertyName: string | null;
  unitLabel: string | null;
  amount: string;
  currency: string;
  paidAt: string;
  method: string;
  concept: string | null;
  reference: string | null;
  logoUrl: string | null;
  accentColor: string | null;
}

export function receiptNumber(paymentId: string): string {
  return `REC-${paymentId.slice(0, 8).toUpperCase()}`;
}

export async function loadPaymentReceipt(orgId: string, paymentId: string, tenantProfileId?: string): Promise<PaymentReceipt | null> {
  const filters: SQL[] = [eq(payments.id, paymentId), eq(payments.orgId, orgId), eq(payments.status, 'approved')];
  if (tenantProfileId) filters.push(eq(tenants.profileId, tenantProfileId));

  const [row] = await db
    .select({
      id: payments.id,
      orgName: organizations.name,
      tenantName: tenants.fullName,
      propertyName: properties.name,
      unitLabel: units.label,
      amount: payments.amount,
      currency: payments.currency,
      paidAt: payments.paidAt,
      method: payments.method,
      concept: payments.concept,
      periodMonth: payments.periodMonth,
      reference: payments.reference,
      logoKey: orgBranding.logoKey,
      accentColor: orgBranding.accentColor,
      brandingUpdatedAt: orgBranding.updatedAt,
    })
    .from(payments)
    .innerJoin(organizations, eq(organizations.id, payments.orgId))
    .leftJoin(orgBranding, eq(orgBranding.orgId, payments.orgId))
    .innerJoin(tenants, and(eq(tenants.id, payments.tenantId), eq(tenants.orgId, orgId)))
    .leftJoin(contracts, and(eq(contracts.id, payments.contractId), eq(contracts.orgId, orgId)))
    .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, orgId)))
    .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, orgId)))
    .where(and(...filters))
    .limit(1);

  if (!row) return null;
  const { id, periodMonth, logoKey, accentColor, brandingUpdatedAt, ...rest } = row;
  const branding = toBrandingDto(brandingUpdatedAt ? { logoKey, accentColor, updatedAt: brandingUpdatedAt } : null);
  return { ...rest, ...branding, number: receiptNumber(id), concept: row.concept ?? periodMonth };
}
