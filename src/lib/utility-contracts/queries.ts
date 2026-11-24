import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { properties, units, utilityContracts, utilityHolderChanges } from '@/lib/db/schema';
import type { ContractInput } from './schemas';

export const CONTRACTS_PAGE_SIZE = 20;

/** Property, its units, one page of utility contracts and their holder changes, in one D1 round trip. */
export async function loadPropertyUtilities(orgId: string, propertyId: string, page: number) {
  const scope = and(eq(utilityContracts.orgId, orgId), eq(utilityContracts.propertyId, propertyId));
  const order = [desc(utilityContracts.createdAt), desc(utilityContracts.id)];
  const offset = (page - 1) * CONTRACTS_PAGE_SIZE;
  const pageIds = db.select({ id: utilityContracts.id }).from(utilityContracts)
    .where(scope).orderBy(...order).limit(CONTRACTS_PAGE_SIZE + 1).offset(offset);
  const [propertyRows, unitRows, contractRows, changeRows] = await db.batch([
    db.select({
      id: properties.id,
      name: properties.name,
      address: properties.address,
      city: properties.city,
      country: properties.country,
    }).from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.orgId, orgId))).limit(1),
    db.select({ id: units.id, label: units.label }).from(units)
      .where(and(eq(units.propertyId, propertyId), eq(units.orgId, orgId)))
      .orderBy(asc(units.label)).limit(500),
    db.select({
      id: utilityContracts.id,
      unitId: utilityContracts.unitId,
      unitLabel: units.label,
      utilityType: utilityContracts.utilityType,
      provider: utilityContracts.provider,
      supplyNumber: utilityContracts.supplyNumber,
      holderKind: utilityContracts.holderKind,
      holderName: utilityContracts.holderName,
      monthlyEstimate: utilityContracts.monthlyEstimate,
      startDate: utilityContracts.startDate,
      notes: utilityContracts.notes,
    }).from(utilityContracts)
      .leftJoin(units, and(eq(units.id, utilityContracts.unitId), eq(units.orgId, orgId)))
      .where(scope).orderBy(...order).limit(CONTRACTS_PAGE_SIZE + 1).offset(offset),
    db.select({
      id: utilityHolderChanges.id,
      contractId: utilityHolderChanges.contractId,
      changedOn: utilityHolderChanges.changedOn,
      fromHolder: utilityHolderChanges.fromHolder,
      toHolder: utilityHolderChanges.toHolder,
      reason: utilityHolderChanges.reason,
    }).from(utilityHolderChanges)
      .where(and(eq(utilityHolderChanges.orgId, orgId), inArray(utilityHolderChanges.contractId, pageIds)))
      .orderBy(desc(utilityHolderChanges.changedOn), desc(utilityHolderChanges.createdAt))
      .limit(500),
  ]);

  const property = propertyRows[0];
  if (!property) return null;
  const hasMore = contractRows.length > CONTRACTS_PAGE_SIZE;
  const contracts = contractRows.slice(0, CONTRACTS_PAGE_SIZE).map((contract) => ({
    ...contract,
    changes: changeRows.filter((change) => change.contractId === contract.id),
  }));
  return { property, units: unitRows, contracts, hasMore };
}

export type PropertyUtilities = NonNullable<Awaited<ReturnType<typeof loadPropertyUtilities>>>;
export type UtilityContractRow = PropertyUtilities['contracts'][number];

/** True when the property (and the unit, if given) belong to the org and to each other. */
export async function scopeBelongsToOrg(orgId: string, propertyId: string, unitId?: string): Promise<boolean> {
  const rows = unitId
    ? await db.select({ id: units.id }).from(units)
      .innerJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, orgId)))
      .where(and(eq(units.id, unitId), eq(units.propertyId, propertyId), eq(units.orgId, orgId))).limit(1)
    : await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.orgId, orgId))).limit(1);
  return rows.length > 0;
}

export async function findContract(orgId: string, id: string) {
  const rows = await db.select({ propertyId: utilityContracts.propertyId, holderName: utilityContracts.holderName })
    .from(utilityContracts)
    .where(and(eq(utilityContracts.id, id), eq(utilityContracts.orgId, orgId))).limit(1);
  return rows[0] ?? null;
}

function contractValues(input: Omit<ContractInput, 'id'>) {
  return {
    unitId: input.unit_id ?? null,
    utilityType: input.utility_type,
    provider: input.provider,
    supplyNumber: input.supply_number ?? null,
    monthlyEstimate: input.monthly_estimate === undefined ? null : input.monthly_estimate.toFixed(2),
    startDate: input.start_date ?? null,
    notes: input.notes ?? null,
  };
}

export async function insertContract(
  orgId: string,
  propertyId: string,
  input: Omit<ContractInput, 'id'> & { holder_kind: string; holder_name: string },
): Promise<void> {
  await db.insert(utilityContracts).values({
    orgId,
    propertyId,
    holderKind: input.holder_kind,
    holderName: input.holder_name,
    ...contractValues(input),
  });
}

export async function updateContract(orgId: string, input: ContractInput): Promise<void> {
  await db.update(utilityContracts)
    .set({ ...contractValues(input), updatedAt: new Date() })
    .where(and(eq(utilityContracts.id, input.id), eq(utilityContracts.orgId, orgId)));
}

export async function recordHolderChange(
  orgId: string,
  change: { id: string; fromHolder: string; holderKind: string; holderName: string; changedOn: string; reason?: string },
): Promise<void> {
  await db.batch([
    db.update(utilityContracts)
      .set({ holderKind: change.holderKind, holderName: change.holderName, updatedAt: new Date() })
      .where(and(eq(utilityContracts.id, change.id), eq(utilityContracts.orgId, orgId))),
    db.insert(utilityHolderChanges).values({
      orgId,
      contractId: change.id,
      changedOn: change.changedOn,
      fromHolder: change.fromHolder,
      toHolder: change.holderName,
      reason: change.reason ?? null,
    }),
  ]);
}

/** Returns the contract's property id, or null when it is not in this org. */
export async function deleteContract(orgId: string, id: string): Promise<string | null> {
  const rows = await db.delete(utilityContracts)
    .where(and(eq(utilityContracts.id, id), eq(utilityContracts.orgId, orgId)))
    .returning({ propertyId: utilityContracts.propertyId });
  return rows[0]?.propertyId ?? null;
}
