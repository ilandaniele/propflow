/**
 * tests/unit/airtable/client.test.ts
 *
 * AC5: Airtable client reads via env-var PAT with Bearer Authorization header.
 * Covers: listRecords success, pagination, 429 retry with back-off, network error.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AirtableClient, AirtableApiError, _resetAirtableClientForTest } from '@/lib/airtable/client';
import { AirtableNotConfiguredError } from '@/lib/airtable/env';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

const VALID_ENV = {
  AIRTABLE_PAT: 'pat.test_token_abc123',
  AIRTABLE_BASE_ID: 'appABCDEF12345678',
  AIRTABLE_TABLE_ROOMS: 'tblROOMS123',
};

function setEnv(overrides: Partial<typeof VALID_ENV> & Record<string, string | undefined> = {}) {
  const merged = { ...VALID_ENV, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearAirtableEnv() {
  for (const key of ['AIRTABLE_PAT', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_ROOMS',
    'AIRTABLE_TABLE_PERFORMANCE', 'AIRTABLE_TABLE_KPIS']) {
    delete process.env[key];
  }
}

// ---------------------------------------------------------------------------
// Mock record builder
// ---------------------------------------------------------------------------

function makeRecord(id: string, name: string): AirtableRecord {
  return {
    id,
    createdTime: '2026-01-01T00:00:00.000Z',
    fields: {
      Name: name,
      Property: 'Casa Test',
      'Monthly Rent': 500,
      Status: 'Vacant',
    },
  };
}

function makeListResponse(records: AirtableRecord[], offset?: string) {
  return JSON.stringify({ records, ...(offset ? { offset } : {}) });
}

// ---------------------------------------------------------------------------
// AirtableClient — construction
// ---------------------------------------------------------------------------

describe('AirtableClient — construction', () => {
  beforeEach(() => clearAirtableEnv());
  afterEach(() => {
    clearAirtableEnv();
    _resetAirtableClientForTest();
  });

  it('AC8: throws AirtableNotConfiguredError when AIRTABLE_PAT is missing', () => {
    setEnv({ AIRTABLE_PAT: undefined });
    expect(() => new AirtableClient()).toThrow(AirtableNotConfiguredError);
  });

  it('AC8: throws AirtableNotConfiguredError when AIRTABLE_BASE_ID is missing', () => {
    setEnv({ AIRTABLE_BASE_ID: undefined });
    expect(() => new AirtableClient()).toThrow(AirtableNotConfiguredError);
  });

  it('constructs successfully with valid env vars', () => {
    setEnv();
    expect(() => new AirtableClient()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AirtableClient.listRecords — success
// ---------------------------------------------------------------------------

describe('AirtableClient.listRecords — success', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setEnv();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    clearAirtableEnv();
    fetchSpy.mockRestore();
    _resetAirtableClientForTest();
  });

  it('AC5: issues GET with Authorization: Bearer header', async () => {
    const record = makeRecord('rec001', 'Habitación 1');
    fetchSpy.mockResolvedValueOnce(
      new Response(makeListResponse([record]), { status: 200 })
    );

    const client = new AirtableClient();
    await client.listRecords('AIRTABLE_TABLE_ROOMS');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.airtable.com/v0/appABCDEF12345678/tblROOMS123');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer pat.test_token_abc123');
  });

  it('returns parsed AirtableRecord[] with correct ids and fields', async () => {
    const records = [makeRecord('rec001', 'Hab 1'), makeRecord('rec002', 'Hab 2')];
    fetchSpy.mockResolvedValueOnce(
      new Response(makeListResponse(records), { status: 200 })
    );

    const client = new AirtableClient();
    const result = await client.listRecords('AIRTABLE_TABLE_ROOMS');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('rec001');
    expect(result[1].id).toBe('rec002');
    expect(result[0].fields['Name']).toBe('Hab 1');
  });

  it('follows pagination offset to fetch all pages', async () => {
    const page1 = [makeRecord('rec001', 'Hab 1')];
    const page2 = [makeRecord('rec002', 'Hab 2')];

    fetchSpy
      .mockResolvedValueOnce(new Response(makeListResponse(page1, 'offset_cursor_abc'), { status: 200 }))
      .mockResolvedValueOnce(new Response(makeListResponse(page2), { status: 200 }));

    const client = new AirtableClient();
    const result = await client.listRecords('AIRTABLE_TABLE_ROOMS');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    // Second call must include the offset parameter
    const [url2] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url2).toContain('offset=offset_cursor_abc');
  });

  it('stops pagination when no offset is returned', async () => {
    const page1 = [makeRecord('rec001', 'Hab 1')];
    fetchSpy.mockResolvedValueOnce(
      new Response(makeListResponse(page1), { status: 200 })
    );

    const client = new AirtableClient();
    const result = await client.listRecords('AIRTABLE_TABLE_ROOMS');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
  });

  it('respects maxRecords option and returns at most that many records', async () => {
    const manyRecords = Array.from({ length: 10 }, (_, i) => makeRecord(`rec${i}`, `Hab ${i}`));
    fetchSpy.mockResolvedValue(
      new Response(makeListResponse(manyRecords), { status: 200 })
    );

    const client = new AirtableClient();
    const result = await client.listRecords('AIRTABLE_TABLE_ROOMS', { maxRecords: 3 });

    expect(result).toHaveLength(3);
  });

  it('uses no-store cache mode to avoid Next.js caching Airtable data', async () => {
    const record = makeRecord('rec001', 'Hab 1');
    fetchSpy.mockResolvedValueOnce(
      new Response(makeListResponse([record]), { status: 200 })
    );

    const client = new AirtableClient();
    await client.listRecords('AIRTABLE_TABLE_ROOMS');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init as RequestInit).cache).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------
// AirtableClient.listRecords — 429 retry
// Use immediate setTimeout mock so back-off delays complete synchronously
// ---------------------------------------------------------------------------

describe('AirtableClient.listRecords — 429 retry', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setEnv();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Mock setTimeout to resolve immediately — avoids real back-off delays in unit tests
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (fn: TimerHandler) => { (fn as () => void)(); return 0 as unknown as ReturnType<typeof setTimeout>; }
    );
  });

  afterEach(() => {
    clearAirtableEnv();
    fetchSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    _resetAirtableClientForTest();
  });

  it('retries on 429 and succeeds on second attempt', async () => {
    const record = makeRecord('rec001', 'Hab 1');
    fetchSpy
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(makeListResponse([record]), { status: 200 }));

    const client = new AirtableClient();
    const result = await client.listRecords('AIRTABLE_TABLE_ROOMS');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
  });

  it('throws AirtableApiError after max retries on persistent 429', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 429 }));

    const client = new AirtableClient();
    await expect(client.listRecords('AIRTABLE_TABLE_ROOMS')).rejects.toThrow(AirtableApiError);
  });
});

// ---------------------------------------------------------------------------
// AirtableClient.listRecords — error cases
// ---------------------------------------------------------------------------

describe('AirtableClient.listRecords — error cases', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setEnv();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    clearAirtableEnv();
    fetchSpy.mockRestore();
    _resetAirtableClientForTest();
  });

  it('throws AirtableApiError on 401 Unauthorized', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"error":"AUTHENTICATION_REQUIRED"}', { status: 401 }));

    const client = new AirtableClient();
    await expect(client.listRecords('AIRTABLE_TABLE_ROOMS')).rejects.toThrow(AirtableApiError);
  });

  it('throws AirtableApiError on 404 Not Found', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"error":"NOT_FOUND"}', { status: 404 }));

    const client = new AirtableClient();
    await expect(client.listRecords('AIRTABLE_TABLE_ROOMS')).rejects.toThrow(AirtableApiError);
  });

  it('throws AirtableApiError when response shape is unexpected', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"unexpected_key":[]}', { status: 200 }));

    const client = new AirtableClient();
    await expect(client.listRecords('AIRTABLE_TABLE_ROOMS')).rejects.toThrow(AirtableApiError);
  });

  it('propagates network errors as-is', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const client = new AirtableClient();
    await expect(client.listRecords('AIRTABLE_TABLE_ROOMS')).rejects.toThrow('Failed to fetch');
  });

  it('throws AirtableNotConfiguredError when table env var is missing', async () => {
    setEnv();
    delete process.env['AIRTABLE_TABLE_ROOMS'];

    const client = new AirtableClient();
    await expect(client.listRecords('AIRTABLE_TABLE_ROOMS')).rejects.toThrow(AirtableNotConfiguredError);
  });
});
