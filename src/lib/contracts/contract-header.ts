import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, organizations, properties, tenants, units } from '@/lib/db/schema';

export type ContractHeader = { code: string | null; orgName: string; tenant: string; property: string; term: string };

export async function contractHeader(orgId: string, contractId: string): Promise<ContractHeader | null> {
  const [row] = await db
    .select({
      contractCode: contracts.contractCode,
      startDate:    contracts.startDate,
      endDate:      contracts.endDate,
      tenantName:   tenants.fullName,
      unitLabel:    units.label,
      propertyName: properties.name,
      orgName:      organizations.name,
    })
    .from(contracts)
    .innerJoin(organizations, eq(organizations.id, contracts.orgId))
    .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, orgId)))
    .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, orgId)))
    .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, orgId)))
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .limit(1);
  if (!row) return null;
  return {
    code:     row.contractCode,
    orgName:  row.orgName,
    tenant:   row.tenantName ?? '',
    property: [row.propertyName, row.unitLabel].filter(Boolean).join(' · '),
    term:     [row.startDate, row.endDate].filter(Boolean).join(' → '),
  };
}
