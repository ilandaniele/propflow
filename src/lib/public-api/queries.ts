import { and, asc, eq, like } from 'drizzle-orm';
import { db } from '@/lib/db';
import { payments, properties, tenants, units } from '@/lib/db/schema';
import type { ApiPage } from './pagination';

const withLookahead = (page: ApiPage) => ({ limit: page.limit + 1, offset: page.offset });

export function listPropertiesForApi(orgId: string, page: ApiPage) {
  const { limit, offset } = withLookahead(page);
  return db
    .select({
      id: properties.id,
      name: properties.name,
      address: properties.address,
      district: properties.district,
      city: properties.city,
      country: properties.country,
      createdAt: properties.createdAt,
    })
    .from(properties)
    .where(eq(properties.orgId, orgId))
    .orderBy(asc(properties.createdAt), asc(properties.id))
    .limit(limit)
    .offset(offset);
}

export function listUnitsForApi(orgId: string, page: ApiPage, filters: { propertyId?: string }) {
  const { limit, offset } = withLookahead(page);
  const conditions = [eq(units.orgId, orgId)];
  if (filters.propertyId) conditions.push(eq(units.propertyId, filters.propertyId));
  return db
    .select({
      id: units.id,
      propertyId: units.propertyId,
      label: units.label,
      floor: units.floor,
      bedrooms: units.bedrooms,
      areaM2: units.areaM2,
      status: units.status,
      monthlyRentDefault: units.monthlyRentDefault,
      createdAt: units.createdAt,
    })
    .from(units)
    .where(and(...conditions))
    .orderBy(asc(units.createdAt), asc(units.id))
    .limit(limit)
    .offset(offset);
}

export function listTenantsForApi(orgId: string, page: ApiPage) {
  const { limit, offset } = withLookahead(page);
  return db
    .select({
      id: tenants.id,
      fullName: tenants.fullName,
      email: tenants.email,
      phone: tenants.phone,
      unitId: tenants.unitId,
      moveInDate: tenants.moveInDate,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(eq(tenants.orgId, orgId))
    .orderBy(asc(tenants.createdAt), asc(tenants.id))
    .limit(limit)
    .offset(offset);
}

export function listPaymentsForApi(orgId: string, page: ApiPage, filters: { month?: string; status?: string }) {
  const { limit, offset } = withLookahead(page);
  const conditions = [eq(payments.orgId, orgId)];
  if (filters.month) conditions.push(like(payments.paidAt, `${filters.month}-%`));
  if (filters.status) conditions.push(eq(payments.status, filters.status));
  return db
    .select({
      id: payments.id,
      tenantId: payments.tenantId,
      contractId: payments.contractId,
      amount: payments.amount,
      currency: payments.currency,
      paidAt: payments.paidAt,
      method: payments.method,
      status: payments.status,
      movementType: payments.movementType,
      periodMonth: payments.periodMonth,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(and(...conditions))
    .orderBy(asc(payments.paidAt), asc(payments.id))
    .limit(limit)
    .offset(offset);
}
