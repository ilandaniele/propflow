'use server';

/**
 * Airtable Server Actions — admin-only, rate-limited.
 *
 * AC7: runAirtableSync triggers syncAirtableTable for configured tables.
 * AC30: begins with requireAdmin(), validates with Zod, applies mutationRateLimit,
 *       returns Errors.* envelope on failure.
 */

import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { syncAirtableTable } from '@/lib/airtable/sync';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import type { ActionResult } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RunAirtableSyncSchema = z.object({
  /** The entity type to sync — maps to an AIRTABLE_TABLE_* env var */
  entity: z.enum(['rooms', 'performance', 'kpis']),
});

// ---------------------------------------------------------------------------
// Table env-var map
// ---------------------------------------------------------------------------

const ENTITY_TO_TABLE_ENV_KEY: Record<string, string> = {
  rooms: 'AIRTABLE_TABLE_ROOMS',
  performance: 'AIRTABLE_TABLE_PERFORMANCE',
  kpis: 'AIRTABLE_TABLE_KPIS',
};

// ---------------------------------------------------------------------------
// runAirtableSync
// ---------------------------------------------------------------------------

export interface SyncSummary {
  entity: string;
  count: number;
  logId: string;
  status: 'success' | 'error' | 'partial';
  durationMs: number;
}

/**
 * Server Action: trigger an Airtable sync for a single entity type.
 *
 * Guards: requireAdmin() → mutationRateLimit → Zod validate → syncAirtableTable
 */
export async function runAirtableSync(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<SyncSummary>> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit — 10 sync triggers / minute / user
  const rl = mutationRateLimit(ctx.userId, 'runAirtableSync');
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Validate
  const parsed = RunAirtableSyncSchema.safeParse({
    entity: formData.get('entity'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { entity } = parsed.data;
  const tableEnvKey = ENTITY_TO_TABLE_ENV_KEY[entity];

  // 4. Run sync
  try {
    const result = await syncAirtableTable(ctx.orgId, tableEnvKey);

    if (result.status === 'error') {
      return Errors.INTERNAL();
    }

    return ok<SyncSummary>({
      entity,
      count: result.count,
      logId: result.logId,
      status: result.status,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error('[runAirtableSync] Unexpected error:', error instanceof Error ? error.name : typeof error);
    return Errors.INTERNAL();
  }
}

/**
 * Server Action: sync all configured Airtable entities in sequence.
 * Used by the admin dashboard to trigger a full refresh.
 */
export async function runAllAirtableSyncs(
  _prev: ActionResult
): Promise<ActionResult<SyncSummary[]>> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit — treated as a heavier operation (5 / minute / user)
  const rl = mutationRateLimit(ctx.userId, 'runAllAirtableSyncs');
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Run all syncs in parallel
  const entities = ['rooms', 'performance', 'kpis'] as const;
  const results: SyncSummary[] = [];

  for (const entity of entities) {
    const tableEnvKey = ENTITY_TO_TABLE_ENV_KEY[entity];
    try {
      const result = await syncAirtableTable(ctx.orgId, tableEnvKey);
      results.push({
        entity,
        count: result.count,
        logId: result.logId,
        status: result.status,
        durationMs: result.durationMs,
      });
    } catch (error) {
      console.error(
        '[runAllAirtableSyncs] Sync failed for entity:',
        entity,
        error instanceof Error ? error.name : typeof error
      );
      results.push({
        entity,
        count: 0,
        logId: 'unknown',
        status: 'error',
        durationMs: 0,
      });
    }
  }

  return ok<SyncSummary[]>(results);
}
