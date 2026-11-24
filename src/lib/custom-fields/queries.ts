import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contracts,
  customFieldDefinitions,
  customFieldValues,
  properties,
  tenants,
  units,
} from '@/lib/db/schema';
import type { CustomFieldEntityType, CustomFieldType } from './schemas';

const ENTITY_TABLES = { property: properties, unit: units, tenant: tenants, contract: contracts } as const;

const definitionColumns = {
  id: customFieldDefinitions.id,
  entityType: customFieldDefinitions.entityType,
  key: customFieldDefinitions.key,
  label: customFieldDefinitions.label,
  fieldType: customFieldDefinitions.fieldType,
  options: customFieldDefinitions.options,
  required: customFieldDefinitions.required,
  sortOrder: customFieldDefinitions.sortOrder,
};

const definitionOrder = [asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label)];

export type CustomFieldDefinition = {
  id: string;
  entityType: CustomFieldEntityType;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  required: boolean;
  sortOrder: number;
};

export type CustomFieldWithValue = CustomFieldDefinition & { value: string | null };

export async function listDefinitions(orgId: string): Promise<CustomFieldDefinition[]> {
  const rows = await db.select(definitionColumns).from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.orgId, orgId))
    .orderBy(asc(customFieldDefinitions.entityType), ...definitionOrder);
  return rows as CustomFieldDefinition[];
}

export async function listEntityDefinitions(orgId: string, entityType: CustomFieldEntityType): Promise<CustomFieldDefinition[]> {
  const rows = await db.select(definitionColumns).from(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.orgId, orgId), eq(customFieldDefinitions.entityType, entityType)))
    .orderBy(...definitionOrder);
  return rows as CustomFieldDefinition[];
}

/** Definitions of one entity type joined with the values of one record, in a single query. */
export async function listEntityFieldValues(
  orgId: string,
  entityType: CustomFieldEntityType,
  entityId: string,
): Promise<CustomFieldWithValue[]> {
  const rows = await db.select({ ...definitionColumns, value: customFieldValues.value })
    .from(customFieldDefinitions)
    .leftJoin(customFieldValues, and(
      eq(customFieldValues.definitionId, customFieldDefinitions.id),
      eq(customFieldValues.entityId, entityId),
      eq(customFieldValues.orgId, orgId),
    ))
    .where(and(eq(customFieldDefinitions.orgId, orgId), eq(customFieldDefinitions.entityType, entityType)))
    .orderBy(...definitionOrder);
  return rows as CustomFieldWithValue[];
}

export async function countEntityDefinitions(orgId: string, entityType: CustomFieldEntityType): Promise<number> {
  const [row] = await db.select({ n: count() }).from(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.orgId, orgId), eq(customFieldDefinitions.entityType, entityType)));
  return Number(row?.n ?? 0);
}

export async function definitionKeyTaken(orgId: string, entityType: CustomFieldEntityType, key: string): Promise<boolean> {
  const rows = await db.select({ id: customFieldDefinitions.id }).from(customFieldDefinitions)
    .where(and(
      eq(customFieldDefinitions.orgId, orgId),
      eq(customFieldDefinitions.entityType, entityType),
      eq(customFieldDefinitions.key, key),
    ))
    .limit(1);
  return rows.length > 0;
}

export async function findDefinition(orgId: string, id: string): Promise<CustomFieldDefinition | null> {
  const [row] = await db.select(definitionColumns).from(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.orgId, orgId)))
    .limit(1);
  return (row as CustomFieldDefinition | undefined) ?? null;
}

export async function insertDefinition(orgId: string, values: Omit<CustomFieldDefinition, 'id'>): Promise<void> {
  await db.insert(customFieldDefinitions).values({ orgId, ...values });
}

export async function updateDefinition(
  orgId: string,
  id: string,
  values: Pick<CustomFieldDefinition, 'label' | 'required' | 'sortOrder' | 'options'>,
): Promise<boolean> {
  const rows = await db.update(customFieldDefinitions)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.orgId, orgId)))
    .returning({ id: customFieldDefinitions.id });
  return rows.length > 0;
}

export async function deleteDefinition(orgId: string, id: string): Promise<boolean> {
  const rows = await db.delete(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.orgId, orgId)))
    .returning({ id: customFieldDefinitions.id });
  return rows.length > 0;
}

export async function entityBelongsToOrg(orgId: string, entityType: CustomFieldEntityType, entityId: string): Promise<boolean> {
  const table = ENTITY_TABLES[entityType];
  const rows = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.id, entityId), eq(table.orgId, orgId)))
    .limit(1);
  return rows.length > 0;
}

/** Upserts non-null values and deletes cleared ones for one record, in one batch. */
export async function saveEntityFieldValues(
  orgId: string,
  entityId: string,
  values: { definitionId: string; value: string | null }[],
): Promise<void> {
  const now = new Date();
  const toUpsert = values.filter((v): v is { definitionId: string; value: string } => v.value !== null);
  const toClear = values.filter((v) => v.value === null).map((v) => v.definitionId);

  const statements = [
    ...toUpsert.map((v) => db.insert(customFieldValues)
      .values({ orgId, definitionId: v.definitionId, entityId, value: v.value, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [customFieldValues.definitionId, customFieldValues.entityId],
        set: { value: v.value, updatedAt: now },
      })),
    ...(toClear.length
      ? [db.delete(customFieldValues).where(and(
          eq(customFieldValues.orgId, orgId),
          eq(customFieldValues.entityId, entityId),
          inArray(customFieldValues.definitionId, toClear),
        ))]
      : []),
  ];
  if (statements.length === 0) return;
  const [first, ...rest] = statements;
  await db.batch([first, ...rest]);
}
