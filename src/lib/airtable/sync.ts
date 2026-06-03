/**
 * Airtable sync service — server-only.
 *
 * AC7: syncAirtableTable() fetches records from Airtable, upserts them into
 * airtable_snapshots (ON CONFLICT DO UPDATE), and writes a row to airtable_sync_logs
 * with status ('success'|'error'|'partial'), count, and timing.
 *
 * Uses the service-role Supabase client because cron runs outside any user session.
 * Accepts an optional normalizer to transform raw AirtableRecord before storage.
 *
 * NEVER import in 'use client' components.
 */

import { getAirtableClient } from './client';
import type { AirtableRecord } from '@/lib/schemas/airtable';
import { createAdminClient } from '@/lib/supabase/admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  /** Log row id written to airtable_sync_logs */
  logId: string;
  /** Number of records successfully upserted */
  count: number;
  /** Final sync status */
  status: 'success' | 'error' | 'partial';
  /** Error message when status = 'error' or 'partial' */
  errorMessage?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Optional normalizer: transform a raw AirtableRecord into the JSONB payload
 * that will be stored in airtable_snapshots.data.
 * Defaults to storing the full raw record when not provided.
 */
export type AirtableNormalizer = (record: AirtableRecord) => Record<string, unknown>;

// ---------------------------------------------------------------------------
// Default normalizer — stores the full raw record as-is
// ---------------------------------------------------------------------------

function defaultNormalizer(record: AirtableRecord): Record<string, unknown> {
  return {
    id: record.id,
    createdTime: record.createdTime,
    fields: record.fields,
  };
}

// ---------------------------------------------------------------------------
// syncAirtableTable
// ---------------------------------------------------------------------------

/**
 * Fetch all records from a given Airtable table and upsert them into
 * public.airtable_snapshots, then write a sync log entry.
 *
 * @param orgId       The organization UUID that owns these snapshots
 * @param tableEnvKey The env-var key whose value is the Airtable table id/name
 *                    e.g. 'AIRTABLE_TABLE_ROOMS'
 * @param normalizer  Optional transform applied to each record before storage;
 *                    defaults to storing the full raw Airtable record
 * @returns           SyncResult with logId, count, status, and duration
 *
 * @throws            Never — errors are captured and written to airtable_sync_logs
 */
export async function syncAirtableTable(
  orgId: string,
  tableEnvKey: string,
  normalizer?: AirtableNormalizer
): Promise<SyncResult> {
  const startedAt = new Date();
  const supabase = createAdminClient();
  const normalize = normalizer ?? defaultNormalizer;

  // Derive a stable table_name from the env-var key for use as the snapshot bucket.
  // e.g. 'AIRTABLE_TABLE_ROOMS' → 'rooms'
  const tableName = tableEnvKey
    .replace(/^AIRTABLE_TABLE_/, '')
    .toLowerCase();

  let records: AirtableRecord[] = [];
  let fetchError: string | undefined;

  // ── 1. Fetch records from Airtable ───────────────────────────────────────
  try {
    const client = getAirtableClient();
    records = await client.listRecords(tableEnvKey);
  } catch (error) {
    fetchError =
      error instanceof Error
        ? error.message
        : 'Unknown error during Airtable fetch';
  }

  // If fetch failed entirely, write error log and return early
  if (fetchError !== undefined) {
    const logId = await writeLog(supabase, {
      orgId,
      tableName,
      status: 'error',
      recordsUpserted: 0,
      errorMessage: fetchError,
      startedAt,
      completedAt: new Date(),
    });
    return {
      logId,
      count: 0,
      status: 'error',
      errorMessage: fetchError,
      durationMs: Date.now() - startedAt.getTime(),
    };
  }

  // ── 2. Upsert records into airtable_snapshots ─────────────────────────────
  const now = new Date().toISOString();
  let upsertedCount = 0;
  let upsertError: string | undefined;

  if (records.length > 0) {
    const rows = records.map(record => ({
      org_id: orgId,
      table_name: tableName,
      external_id: record.id,
      data: normalize(record),
      synced_at: now,
    }));

    // Upsert in batches of 200 to avoid payload limits
    const BATCH_SIZE = 200;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('airtable_snapshots')
        .upsert(batch, {
          onConflict: 'org_id,table_name,external_id',
          ignoreDuplicates: false, // DO UPDATE SET data + synced_at
        });

      if (error) {
        upsertError = `Upsert batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`;
        break;
      }
      upsertedCount += batch.length;
    }
  }

  // ── 3. Determine final status ─────────────────────────────────────────────
  let status: 'success' | 'error' | 'partial';
  if (upsertError) {
    status = upsertedCount > 0 ? 'partial' : 'error';
  } else {
    status = 'success';
  }

  // ── 4. Write sync log ─────────────────────────────────────────────────────
  const completedAt = new Date();
  const logId = await writeLog(supabase, {
    orgId,
    tableName,
    status,
    recordsUpserted: upsertedCount,
    errorMessage: upsertError,
    startedAt,
    completedAt,
  });

  return {
    logId,
    count: upsertedCount,
    status,
    errorMessage: upsertError,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };
}

// ---------------------------------------------------------------------------
// writeLog — inserts one row into airtable_sync_logs and returns its id
// ---------------------------------------------------------------------------

interface LogParams {
  orgId: string;
  tableName: string;
  status: 'success' | 'error' | 'partial';
  recordsUpserted: number;
  errorMessage?: string;
  startedAt: Date;
  completedAt: Date;
}

async function writeLog(
  supabase: ReturnType<typeof createAdminClient>,
  params: LogParams
): Promise<string> {
  const { data, error } = await supabase
    .from('airtable_sync_logs')
    .insert({
      org_id: params.orgId,
      table_name: params.tableName,
      status: params.status,
      records_upserted: params.recordsUpserted,
      error_message: params.errorMessage ?? null,
      started_at: params.startedAt.toISOString(),
      completed_at: params.completedAt.toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    // Log to stdout — don't re-throw since the sync may have partially succeeded
    console.error('[airtable-sync] Failed to write sync log:', error?.message ?? 'no data');
    return 'unknown';
  }

  return data.id as string;
}
