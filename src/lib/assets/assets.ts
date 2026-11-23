import { and, asc, desc, eq, gte, lt, max } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db/errors';
import { assetTaskLogs, assetTasks, assets, properties } from '@/lib/db/schema';
import type { AssetInput, AssetTaskInput, CompleteAssetTaskInput } from '@/lib/schemas/asset';

export type CreateAssetResult = { status: 'not_found' } | { status: 'duplicate' } | { status: 'done'; assetId: string };
export type CreateAssetTaskResult = { status: 'not_found' } | { status: 'done'; taskId: string };
export type CompleteAssetTaskResult = { status: 'not_found' } | { status: 'future' } | { status: 'done'; logId: string };

const toMoney = (amount: number | undefined) => (amount === undefined ? null : amount.toFixed(2));

const assetColumns = {
  id: assets.id,
  name: assets.name,
  category: assets.category,
  location: assets.location,
  propertyName: properties.name,
};

export async function createAsset(orgId: string, input: AssetInput): Promise<CreateAssetResult> {
  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, input.property_id), eq(properties.orgId, orgId)))
    .limit(1);
  if (!property) return { status: 'not_found' };

  try {
    const [row] = await db.insert(assets).values({
      orgId,
      propertyId: input.property_id,
      name: input.name,
      category: input.category,
      location: input.location ?? null,
    }).returning({ id: assets.id });
    return { status: 'done', assetId: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    throw error;
  }
}

export async function createAssetTask(orgId: string, input: AssetTaskInput): Promise<CreateAssetTaskResult> {
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, input.asset_id), eq(assets.orgId, orgId)))
    .limit(1);
  if (!asset) return { status: 'not_found' };

  const [row] = await db.insert(assetTasks).values({
    orgId,
    assetId: input.asset_id,
    title: input.title,
    frequencyMonths: input.frequency_months,
    startsOn: input.starts_on,
    responsible: input.responsible ?? null,
    supplier: input.supplier ?? null,
    estimatedCost: toMoney(input.estimated_cost),
  }).returning({ id: assetTasks.id });
  return { status: 'done', taskId: row.id };
}

export async function completeAssetTask(
  orgId: string,
  createdBy: string,
  input: CompleteAssetTaskInput,
  today: string,
): Promise<CompleteAssetTaskResult> {
  if (input.done_on > today) return { status: 'future' };
  const [task] = await db
    .select({ id: assetTasks.id })
    .from(assetTasks)
    .where(and(eq(assetTasks.id, input.task_id), eq(assetTasks.orgId, orgId)))
    .limit(1);
  if (!task) return { status: 'not_found' };

  const [row] = await db.insert(assetTaskLogs).values({
    orgId,
    taskId: input.task_id,
    doneOn: input.done_on,
    cost: toMoney(input.cost),
    notes: input.notes ?? null,
    createdBy,
  }).returning({ id: assetTaskLogs.id });
  return { status: 'done', logId: row.id };
}

export function listAssets(orgId: string) {
  return db
    .select(assetColumns)
    .from(assets)
    .innerJoin(properties, eq(properties.id, assets.propertyId))
    .where(eq(assets.orgId, orgId))
    .orderBy(asc(properties.name), asc(assets.name))
    .limit(500);
}

export async function getAsset(orgId: string, assetId: string) {
  const [row] = await db
    .select(assetColumns)
    .from(assets)
    .innerJoin(properties, eq(properties.id, assets.propertyId))
    .where(and(eq(assets.id, assetId), eq(assets.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export function listAssetTasks(orgId: string, assetId?: string) {
  const scope = assetId ? and(eq(assetTasks.orgId, orgId), eq(assetTasks.assetId, assetId)) : eq(assetTasks.orgId, orgId);
  return db
    .select({
      id: assetTasks.id,
      assetId: assetTasks.assetId,
      assetName: assets.name,
      title: assetTasks.title,
      frequencyMonths: assetTasks.frequencyMonths,
      startsOn: assetTasks.startsOn,
      responsible: assetTasks.responsible,
      supplier: assetTasks.supplier,
      estimatedCost: assetTasks.estimatedCost,
      lastDoneOn: max(assetTaskLogs.doneOn),
    })
    .from(assetTasks)
    .innerJoin(assets, eq(assets.id, assetTasks.assetId))
    .leftJoin(assetTaskLogs, eq(assetTaskLogs.taskId, assetTasks.id))
    .where(scope)
    .groupBy(assetTasks.id)
    .orderBy(asc(assets.name), asc(assetTasks.title))
    .limit(1000);
}

export function assetLogs(orgId: string, assetId: string) {
  return db
    .select({
      id: assetTaskLogs.id,
      taskTitle: assetTasks.title,
      doneOn: assetTaskLogs.doneOn,
      cost: assetTaskLogs.cost,
      notes: assetTaskLogs.notes,
    })
    .from(assetTaskLogs)
    .innerJoin(assetTasks, eq(assetTasks.id, assetTaskLogs.taskId))
    .where(and(eq(assetTaskLogs.orgId, orgId), eq(assetTasks.assetId, assetId)))
    .orderBy(desc(assetTaskLogs.doneOn))
    .limit(200);
}

export function logsForYear(orgId: string, year: number) {
  return db
    .select({ taskId: assetTaskLogs.taskId, doneOn: assetTaskLogs.doneOn })
    .from(assetTaskLogs)
    .where(and(
      eq(assetTaskLogs.orgId, orgId),
      gte(assetTaskLogs.doneOn, `${year}-01-01`),
      lt(assetTaskLogs.doneOn, `${year + 1}-01-01`),
    ))
    .limit(5000);
}

export function orgPropertyOptions(orgId: string) {
  return db
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(eq(properties.orgId, orgId))
    .orderBy(asc(properties.name))
    .limit(200);
}
