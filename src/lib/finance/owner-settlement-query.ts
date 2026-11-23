import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, expenses, owners, payments, properties, propertyOwnerTerms, units } from '@/lib/db/schema';
import { buildOwnerSettlements } from './owner-settlement';

const INCOME_MOVEMENTS = ['payment', 'partial_payment'];

export type SettlementFilter = { month: string; ownerId?: string };

function monthRange(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const next = monthIndex === 12 ? `${year + 1}-01` : `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export async function ownerSettlements(orgId: string, { month, ownerId }: SettlementFilter) {
  const { from, to } = monthRange(month);
  const ownerFilter = ownerId ? eq(propertyOwnerTerms.ownerId, ownerId) : undefined;
  const ownerColumns = {
    ownerId: propertyOwnerTerms.ownerId,
    ownerName: owners.name,
    commissionPct: propertyOwnerTerms.commissionPct,
    propertyName: properties.name,
  };

  const [income, spend] = await Promise.all([
    db
      .select({
        ...ownerColumns,
        propertyId: units.propertyId,
        currency: payments.currency,
        total: sql<number>`coalesce(sum(cast(${payments.amount} as real)), 0)`,
      })
      .from(payments)
      .innerJoin(contracts, eq(contracts.id, payments.contractId))
      .innerJoin(units, eq(units.id, contracts.unitId))
      .innerJoin(propertyOwnerTerms, and(eq(propertyOwnerTerms.propertyId, units.propertyId), eq(propertyOwnerTerms.orgId, orgId)))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(owners, eq(owners.id, propertyOwnerTerms.ownerId))
      .where(and(
        eq(payments.orgId, orgId),
        eq(payments.status, 'approved'),
        inArray(payments.movementType, INCOME_MOVEMENTS),
        gte(payments.paidAt, from),
        lt(payments.paidAt, to),
        ownerFilter,
      ))
      .groupBy(propertyOwnerTerms.ownerId, owners.name, propertyOwnerTerms.commissionPct, units.propertyId, properties.name, payments.currency),
    db
      .select({
        ...ownerColumns,
        propertyId: expenses.propertyId,
        total: sql<number>`coalesce(sum(cast(${expenses.amount} as real)), 0)`,
      })
      .from(expenses)
      .innerJoin(propertyOwnerTerms, and(eq(propertyOwnerTerms.propertyId, expenses.propertyId), eq(propertyOwnerTerms.orgId, orgId)))
      .innerJoin(properties, eq(properties.id, propertyOwnerTerms.propertyId))
      .innerJoin(owners, eq(owners.id, propertyOwnerTerms.ownerId))
      .where(and(eq(expenses.orgId, orgId), gte(expenses.incurredOn, from), lt(expenses.incurredOn, to), ownerFilter))
      .groupBy(propertyOwnerTerms.ownerId, owners.name, propertyOwnerTerms.commissionPct, expenses.propertyId, properties.name),
  ]);

  return buildOwnerSettlements(income, spend);
}

export async function ownerTermsOverview(orgId: string) {
  const [terms, ownerOptions, propertyOptions] = await Promise.all([
    db
      .select({
        propertyId: propertyOwnerTerms.propertyId,
        propertyName: properties.name,
        ownerId: propertyOwnerTerms.ownerId,
        ownerName: owners.name,
        commissionPct: propertyOwnerTerms.commissionPct,
      })
      .from(propertyOwnerTerms)
      .innerJoin(properties, eq(properties.id, propertyOwnerTerms.propertyId))
      .innerJoin(owners, eq(owners.id, propertyOwnerTerms.ownerId))
      .where(eq(propertyOwnerTerms.orgId, orgId))
      .orderBy(asc(owners.name), asc(properties.name))
      .limit(500),
    db.select({ id: owners.id, name: owners.name }).from(owners).where(eq(owners.orgId, orgId)).orderBy(asc(owners.name)).limit(500),
    db.select({ id: properties.id, name: properties.name }).from(properties).where(eq(properties.orgId, orgId)).orderBy(asc(properties.name)).limit(500),
  ]);
  return { terms, ownerOptions, propertyOptions };
}

export async function setPropertyOwnerTerms(orgId: string, input: { propertyId: string; ownerId: string; commissionPct: string }) {
  const [[property], [owner]] = await Promise.all([
    db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.orgId, orgId))),
    db.select({ id: owners.id }).from(owners).where(and(eq(owners.id, input.ownerId), eq(owners.orgId, orgId))),
  ]);
  if (!property || !owner) return false;

  await db
    .insert(propertyOwnerTerms)
    .values({ orgId, ...input })
    .onConflictDoUpdate({
      target: propertyOwnerTerms.propertyId,
      set: { ownerId: input.ownerId, commissionPct: input.commissionPct, updatedAt: new Date() },
    });
  return true;
}
