'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, err, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { AssetSchema, AssetTaskSchema, CompleteAssetTaskSchema } from '@/lib/schemas/asset';
import {
  completeAssetTask as saveCompletion,
  createAsset as saveAsset,
  createAssetTask as saveTask,
} from '@/lib/assets/assets';

const revalidateAssets = () => revalidatePath('/dashboard/assets', 'layout');

export async function createAsset(
  _prev: ActionResult<{ assetId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ assetId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-asset');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AssetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await saveAsset(ctx.orgId, parsed.data);
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'duplicate') return Errors.CONFLICT('An asset with that name already exists in this property');

  log.adminAction(ctx.userId, 'create_asset', 'asset', result.assetId);
  revalidateAssets();
  return ok({ assetId: result.assetId });
}

export async function createAssetTask(
  _prev: ActionResult<{ taskId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ taskId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-asset-task');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AssetTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await saveTask(ctx.orgId, parsed.data);
  if (result.status === 'not_found') return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'create_asset_task', 'asset_task', result.taskId);
  revalidateAssets();
  return ok({ taskId: result.taskId });
}

export async function completeAssetTask(
  _prev: ActionResult<{ logId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ logId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'complete-asset-task');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CompleteAssetTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const today = new Date().toISOString().slice(0, 10);
  const result = await saveCompletion(ctx.orgId, ctx.userId, parsed.data, today);
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'future') return err('FUTURE_DATE', 'Completion date cannot be in the future');

  log.adminAction(ctx.userId, 'complete_asset_task', 'asset_task', parsed.data.task_id);
  revalidateAssets();
  return ok({ logId: result.logId });
}
