/**
 * AirtableClient — server-only, read-only Airtable REST v0 client.
 *
 * AC5: Reads records via env-var PAT with Authorization: Bearer header.
 * AC8: Calls assertAirtableEnv() at construction time — throws if PAT/BASE_ID missing.
 *
 * Features:
 * - Automatic pagination (follows Airtable "offset" cursor until exhausted)
 * - 200ms minimum delay between requests (rate limit: spec allows 5 req/sec)
 * - 429 retry with exponential back-off (max 3 retries per page)
 * - Typed response as AirtableRecord[]
 *
 * NEVER import in 'use client' components.
 */

import { AirtableRecord, AirtableRecordSchema } from '@/lib/schemas/airtable';
import { assertAirtableEnv, assertAirtableBase, resolveTableEnvKey } from './env';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

/** Minimum delay between consecutive Airtable API calls (200ms = 5 req/sec). */
const MIN_REQUEST_INTERVAL_MS = 200;

/** Maximum pages to fetch in a single list call (hard cap: 10000 records). */
const MAX_PAGES = 100; // 100 pages × 100 records/page = 10000 max

/** Page size per Airtable request (Airtable max is 100). */
const PAGE_SIZE = 100;

/** Maximum retry attempts on 429 / transient errors. */
const MAX_RETRIES = 3;

/** Initial back-off delay in ms for exponential back-off. */
const BACKOFF_BASE_MS = 1_000;

// ---------------------------------------------------------------------------
// Wire response schema
// ---------------------------------------------------------------------------

const AirtableListResponseSchema = z.object({
  records: z.array(AirtableRecordSchema),
  offset: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ListRecordsOptions {
  /** Override page size (max 100, Airtable limit). */
  pageSize?: number;
  /** Filter by formula (Airtable formula syntax). */
  filterByFormula?: string;
  /** Sort specification. */
  sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  /** View name to read from. */
  view?: string;
  /** Maximum total records to return (across all pages). 0 = no limit up to MAX_PAGES cap. */
  maxRecords?: number;
}

// ---------------------------------------------------------------------------
// AirtableClient
// ---------------------------------------------------------------------------

export class AirtableClient {
  private readonly pat: string;
  private readonly baseId: string;
  private lastRequestAt = 0;

  constructor() {
    // AC8: fail closed immediately if env vars missing — no HTTP request will be made
    const airtableEnv = assertAirtableEnv();
    this.pat = airtableEnv.pat;
    this.baseId = airtableEnv.baseId;
  }

  /**
   * List all records from a table identified by its env-var key.
   *
   * @param tableEnvKey  Name of the env var that holds the table id/name
   *                     e.g. 'AIRTABLE_TABLE_ROOMS'
   * @param options      Optional filters, sort, view, maxRecords
   * @returns            Flat array of AirtableRecord objects (all pages merged)
   */
  async listRecords(
    tableEnvKey: string,
    options: ListRecordsOptions = {}
  ): Promise<AirtableRecord[]> {
    const tableId = resolveTableEnvKey(tableEnvKey);
    return this.fetchAllPages(tableId, options);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async fetchAllPages(
    tableId: string,
    options: ListRecordsOptions
  ): Promise<AirtableRecord[]> {
    const allRecords: AirtableRecord[] = [];
    let offset: string | undefined;
    let pages = 0;
    const maxRecords = options.maxRecords ?? 0;

    while (pages < MAX_PAGES) {
      const records = await this.fetchPage(tableId, options, offset);
      allRecords.push(...records.records);
      pages++;

      if (maxRecords > 0 && allRecords.length >= maxRecords) {
        return allRecords.slice(0, maxRecords);
      }

      if (!records.offset) break;
      offset = records.offset;
    }

    return allRecords;
  }

  private async fetchPage(
    tableId: string,
    options: ListRecordsOptions,
    offset?: string
  ): Promise<z.infer<typeof AirtableListResponseSchema>> {
    await this.throttle();

    const url = this.buildUrl(tableId, options, offset);
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
      this.lastRequestAt = Date.now();
      const response = await this.doFetch(url);

      if (response.status === 429) {
        if (attempt === MAX_RETRIES) {
          throw new AirtableApiError(429, 'Rate limited by Airtable after max retries');
        }
        const delayMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AirtableApiError(response.status, `Airtable API error: ${response.status} — ${body}`);
      }

      const json: unknown = await response.json();
      const parsed = AirtableListResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new AirtableApiError(
          200,
          `Unexpected Airtable response shape: ${parsed.error.message}`
        );
      }
      return parsed.data;
    }

    // Should never reach here
    throw new AirtableApiError(0, 'Unexpected state in fetchPage retry loop');
  }

  private buildUrl(
    tableId: string,
    options: ListRecordsOptions,
    offset?: string
  ): string {
    const params = new URLSearchParams();
    params.set('pageSize', String(Math.min(options.pageSize ?? PAGE_SIZE, PAGE_SIZE)));

    if (options.filterByFormula) {
      params.set('filterByFormula', options.filterByFormula);
    }
    if (options.view) {
      params.set('view', options.view);
    }
    if (options.sort) {
      options.sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
      });
    }
    if (offset) {
      params.set('offset', offset);
    }

    return `${AIRTABLE_API_BASE}/${this.baseId}/${encodeURIComponent(tableId)}?${params.toString()}`;
  }

  private doFetch(url: string): Promise<Response> {
    return fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.pat}`,
        'Content-Type': 'application/json',
      },
      // Explicit no-store: Airtable data must always be fresh; never serve from Next.js cache
      cache: 'no-store',
    });
  }

  /**
   * Enforce 200ms minimum between requests to stay within Airtable's 5 req/sec limit.
   */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AirtableApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AirtableApiError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Singleton factory — call getAirtableClient() in Server Actions / Route Handlers.
// Each call validates env vars; a new AirtableClient is cheap (no connection pool).
// ---------------------------------------------------------------------------

let _client: AirtableClient | null = null;

/**
 * Returns an AirtableClient instance.
 * Throws AirtableNotConfiguredError if AIRTABLE_PAT or AIRTABLE_BASE_ID is not set.
 * Safe to call at the top of a Server Action before any DB work.
 */
export function getAirtableClient(): AirtableClient {
  // Warn when AIRTABLE_BASE_ID doesn't match the expected base for this project.
  assertAirtableBase();
  if (!_client) {
    _client = new AirtableClient();
  }
  return _client;
}

/**
 * Reset the module-level singleton (for testing only).
 * @internal
 */
export function _resetAirtableClientForTest(): void {
  _client = null;
}
