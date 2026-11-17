/**
 * Minimal read-only Airtable client for the one-off attachment copy.
 * Self-contained on purpose: the Airtable integration is removed separately.
 */

const API_BASE = 'https://api.airtable.com/v0';
const MIN_REQUEST_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const IDS_PER_REQUEST = 10;

export interface AirtableAttachment {
  id: string;
  url: string;
  filename?: string;
  type?: string;
  size?: number;
}

/** recordId -> field name -> attachments (the requested fields, or every field when none are requested). */
export type AttachmentsByRecord = Map<string, Record<string, AirtableAttachment[]>>;

export class AirtableFetchError extends Error {
  constructor(readonly status: number, errorType?: string) {
    super(`airtable_http_${status}${errorType ? `_${errorType}` : ''}`);
    this.name = 'AirtableFetchError';
  }
}

export interface AirtableCredentials {
  pat: string;
  baseId: string;
}

export function readAirtableCredentials(): AirtableCredentials {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!pat || !baseId) throw new Error('airtable_not_configured');
  return { pat, baseId };
}

export function resolveTableId(envKey: string): string | null {
  const value = process.env[envKey];
  return value && value.trim() !== '' ? value : null;
}

/** Airtable's error type (e.g. `UNKNOWN_FIELD_NAME`); never the message, which may echo input. */
async function airtableErrorType(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { error?: string | { type?: unknown } } | null;
  const type = typeof body?.error === 'string' ? body.error : body?.error?.type;
  return typeof type === 'string' && /^[A-Z_]{1,50}$/.test(type) ? type : undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isAttachment(value: unknown): value is AirtableAttachment {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.url === 'string';
}

export class AttachmentFetcher {
  private lastRequestAt = 0;

  constructor(private readonly credentials: AirtableCredentials) {}

  /**
   * Fresh attachment objects for `recordIds`, 10 records per request, throttled to ~4 req/s.
   * Without `fieldNames` every field is returned, so a field renamed in Airtable cannot fail the request.
   */
  async fetchAttachments(
    tableId: string,
    recordIds: readonly string[],
    fieldNames?: readonly string[],
  ): Promise<AttachmentsByRecord> {
    const result: AttachmentsByRecord = new Map();
    for (let i = 0; i < recordIds.length; i += IDS_PER_REQUEST) {
      const chunk = recordIds.slice(i, i + IDS_PER_REQUEST);
      const records = await this.listChunk(tableId, chunk, fieldNames);
      for (const record of records) {
        const fields: Record<string, AirtableAttachment[]> = {};
        for (const name of fieldNames ?? Object.keys(record.fields ?? {})) {
          const value = record.fields?.[name];
          if (Array.isArray(value)) fields[name] = value.filter(isAttachment);
        }
        result.set(record.id, fields);
      }
    }
    return result;
  }

  private async listChunk(
    tableId: string,
    recordIds: readonly string[],
    fieldNames: readonly string[] = [],
  ): Promise<Array<{ id: string; fields?: Record<string, unknown> }>> {
    const params = new URLSearchParams();
    params.set('filterByFormula', `OR(${recordIds.map((id) => `RECORD_ID()='${id.replace(/'/g, '')}'`).join(',')})`);
    params.set('pageSize', String(IDS_PER_REQUEST));
    for (const name of fieldNames) params.append('fields[]', name);
    const url = `${API_BASE}/${this.credentials.baseId}/${encodeURIComponent(tableId)}?${params.toString()}`;

    for (let attempt = 1; ; attempt++) {
      await this.throttle();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.credentials.pat}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = (await res.json()) as { records?: Array<{ id: string; fields?: Record<string, unknown> }> };
        return body.records ?? [];
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw new AirtableFetchError(res.status, await airtableErrorType(res));
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }
}
