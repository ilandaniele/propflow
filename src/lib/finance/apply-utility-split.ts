import { and, eq, inArray, isNull, or, gte, lte, ne, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { charges, contracts, servicePayments, units } from '@/lib/db/schema';
import { monthBounds, splitUtility, type SplitMethod } from './utility-split';

type MonthEntry = { amount?: number | null };

export type UtilitySplitOutcome =
  | { status: 'not_found' }
  | { status: 'no_amount' }
  | { status: 'done'; created: number; skipped: number };

export interface UtilitySplitRequest {
  orgId: string;
  servicePaymentId: string;
  month: string;
  method: SplitMethod;
  dueDate: string;
}

export function utilityChargeDescription(serviceType: string, supplyNumber: string | null, month: string): string {
  return `Servicio ${serviceType}${supplyNumber ? ` #${supplyNumber}` : ''} ${month}`;
}

function loadOccupants(orgId: string, propertyId: string, month: string) {
  const { first, last } = monthBounds(month);
  return db
    .select({
      contractId: contracts.id,
      tenantId: contracts.tenantId,
      areaM2: units.areaM2,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      actualExitDate: contracts.actualExitDate,
    })
    .from(contracts)
    .innerJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, orgId)))
    .where(and(
      eq(contracts.orgId, orgId),
      eq(units.propertyId, propertyId),
      or(ne(contracts.status, 'terminated'), isNotNull(contracts.actualExitDate)),
      lte(contracts.startDate, last),
      or(isNull(contracts.endDate), gte(contracts.endDate, first)),
    ));
}

export async function applyUtilitySplit(request: UtilitySplitRequest): Promise<UtilitySplitOutcome> {
  const { orgId, servicePaymentId, month, method, dueDate } = request;
  const [service] = await db
    .select({
      propertyId: servicePayments.propertyId,
      serviceType: servicePayments.serviceType,
      supplyNumber: servicePayments.supplyNumber,
      tope: servicePayments.tope,
      monthlyData: servicePayments.monthlyData,
    })
    .from(servicePayments)
    .where(and(eq(servicePayments.id, servicePaymentId), eq(servicePayments.orgId, orgId)))
    .limit(1);
  if (!service?.propertyId) return { status: 'not_found' };

  const amount = (service.monthlyData as Record<string, MonthEntry> | null)?.[month]?.amount;
  if (amount === null || amount === undefined) return { status: 'no_amount' };

  const occupantRows = await loadOccupants(orgId, service.propertyId, month);
  const shares = splitUtility({
    amount,
    tope: service.tope === null ? null : Number(service.tope),
    month,
    method,
    occupants: occupantRows.map((row) => ({
      ...row,
      areaM2: row.areaM2 === null ? null : Number(row.areaM2),
      endDate: row.actualExitDate ?? row.endDate,
    })),
  });
  if (shares.length === 0) return { status: 'done', created: 0, skipped: 0 };

  const period = monthBounds(month).first;
  const description = utilityChargeDescription(service.serviceType, service.supplyNumber, month);
  const existing = await db
    .select({ contractId: charges.contractId })
    .from(charges)
    .where(and(
      eq(charges.orgId, orgId),
      eq(charges.period, period),
      eq(charges.description, description),
      inArray(charges.contractId, shares.map((share) => share.contractId)),
    ));
  const alreadyCharged = new Set(existing.map((row) => row.contractId));

  const rows = shares
    .filter((share) => !alreadyCharged.has(share.contractId))
    .map((share) => ({ orgId, contractId: share.contractId, tenantId: share.tenantId, period, description, amount: share.amount.toFixed(2), dueDate }));
  const batch = asBatch(chunk(rows, rowsPerInsert(charges)).map((part) => db.insert(charges).values(part)));
  if (batch) await db.batch(batch);

  return { status: 'done', created: rows.length, skipped: alreadyCharged.size };
}
