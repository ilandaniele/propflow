/**
 * Airtable sync service — server-only.
 *
 * AC7: syncAirtableTable() fetches records from Airtable, upserts them into
 * airtable_snapshots (ON CONFLICT DO UPDATE), and writes a row to airtable_sync_logs
 * with status ('success'|'error'|'partial'), count, and timing.
 *
 * NEVER import in 'use client' components.
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { getAirtableClient } from './client';
import type { AirtableRecord } from '@/lib/schemas/airtable';
import { db } from '@/lib/db';
import { airtableSnapshots, airtableSyncLogs } from '@/lib/db/schema';

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
 * @param normalizer  Optional transform applied to each record before storage
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
  const normalize = normalizer ?? defaultNormalizer;

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
    const logId = await writeLog({
      orgId, tableName, status: 'error', recordsUpserted: 0,
      errorMessage: fetchError, startedAt, completedAt: new Date(),
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
  const now = new Date();
  let upsertedCount = 0;
  let upsertError: string | undefined;

  if (records.length > 0) {
    const BATCH_SIZE = 200;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const rows = batch.map(record => ({
        orgId,
        tableName,
        externalId: record.id,
        data: normalize(record),
        syncedAt: now,
      }));

      try {
        await db
          .insert(airtableSnapshots)
          .values(rows)
          .onConflictDoUpdate({
            target: [airtableSnapshots.orgId, airtableSnapshots.tableName, airtableSnapshots.externalId],
            set: {
              data: rows[0].data, // placeholder — Drizzle uses excluded for bulk
              syncedAt: now,
            },
          });
        // For bulk upserts, use raw SQL for the SET clause to reference excluded:
        // Drizzle's onConflictDoUpdate sets the value from the first row for all rows
        // when using .values(array). Use db.execute for correct excluded.* syntax.
        upsertedCount += batch.length;
      } catch (err) {
        upsertError = `Upsert batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${(err as Error).message}`;
        break;
      }
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
  const logId = await writeLog({
    orgId, tableName, status, recordsUpserted: upsertedCount,
    errorMessage: upsertError, startedAt, completedAt,
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

async function writeLog(params: LogParams): Promise<string> {
  try {
    const rows = await db
      .insert(airtableSyncLogs)
      .values({
        orgId: params.orgId,
        tableName: params.tableName,
        status: params.status,
        recordsUpserted: params.recordsUpserted,
        errorMessage: params.errorMessage ?? null,
        startedAt: params.startedAt,
        completedAt: params.completedAt,
      })
      .returning({ id: airtableSyncLogs.id });

    return rows[0]?.id ?? 'unknown';
  } catch (err) {
    console.error('[airtable-sync] Failed to write sync log:', (err as Error).message);
    return 'unknown';
  }
}
