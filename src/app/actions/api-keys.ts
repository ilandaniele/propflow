'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { generateApiKey } from '@/lib/api-keys/token';
import { insertApiKey, revokeApiKey } from '@/lib/api-keys/queries';

const API_KEYS_PATH = '/dashboard/admin/api-keys';
const CreateApiKeySchema = z.object({ name: z.string().trim().min(1).max(80) });
const RevokeApiKeySchema = z.object({ id: z.string().uuid() });

export async function createApiKey(_prev: ActionResult<{ token: string }>, formData: FormData): Promise<ActionResult<{ token: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'create-api-key').success) return Errors.RATE_LIMITED();

  const parsed = CreateApiKeySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    const { token, prefix, keyHash } = generateApiKey();
    const row = await insertApiKey({ orgId: ctx.orgId, name: parsed.data.name, prefix, keyHash, createdBy: ctx.userId });
    log.adminAction(ctx.userId, 'create_api_key', 'api_key', row.id);
    revalidatePath(API_KEYS_PATH);
    return { data: { token } };
  } catch (error) {
    log.error('api_keys.create_failed', { error: error instanceof Error ? error.message : String(error) });
    return Errors.INTERNAL();
  }
}

export async function revokeApiKeyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'revoke-api-key').success) return Errors.RATE_LIMITED();

  const parsed = RevokeApiKeySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    if (!(await revokeApiKey(ctx.orgId, parsed.data.id))) return Errors.NOT_FOUND();
    log.adminAction(ctx.userId, 'revoke_api_key', 'api_key', parsed.data.id);
    revalidatePath(API_KEYS_PATH);
    return { data: undefined };
  } catch (error) {
    log.error('api_keys.revoke_failed', { error: error instanceof Error ? error.message : String(error) });
    return Errors.INTERNAL();
  }
}
