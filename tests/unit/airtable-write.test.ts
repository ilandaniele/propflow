/**
 * tests/unit/airtable-write.test.ts
 *
 * Tests for src/lib/airtable/write.ts — upsertAirtableResidente()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Environment setup helpers
// ---------------------------------------------------------------------------

function setEnv() {
  process.env['AIRTABLE_PAT']             = 'pat.test_token';
  process.env['AIRTABLE_BASE_ID']         = 'appTEST12345678';
  process.env['AIRTABLE_TABLE_RESIDENTES'] = 'tblResidentes001';
}

function clearEnv() {
  delete process.env['AIRTABLE_PAT'];
  delete process.env['AIRTABLE_BASE_ID'];
  delete process.env['AIRTABLE_TABLE_RESIDENTES'];
}

function makeOkResponse(id: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id }),
  };
}

function makeErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { type: 'NOT_FOUND', message: 'Not Found' } }),
  };
}

const TENANT = {
  first_name: 'María',
  last_name:  'García',
  email:      'maria@example.com',
  phone:      '999888777',
  dni:        '12345678',
  birth_date: '1990-05-15',
};

// Import SUT after globals are stubbed
import { upsertAirtableResidente } from '@/lib/airtable/write';

describe('upsertAirtableResidente()', () => {
  beforeEach(() => {
    setEnv();
    mockFetch.mockReset();
  });

  afterEach(clearEnv);

  // ── POST path (no existingAirtableId) ──────────────────────────────────────

  it('calls POST when existingAirtableId is null', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse('recNEW001'));
    const result = await upsertAirtableResidente(TENANT, null);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
    expect(result.airtableRecordId).toBe('recNEW001');
    expect(result.created).toBe(true);
  });

  it('calls POST when existingAirtableId is undefined (not provided)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse('recNEW002'));
    const result = await upsertAirtableResidente(TENANT);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
    expect(result.created).toBe(true);
  });

  // ── PATCH path (existingAirtableId provided) ────────────────────────────────

  it('calls PATCH when existingAirtableId is provided', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse('recEXIST001'));
    const result = await upsertAirtableResidente(TENANT, 'recEXIST001');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('PATCH');
    expect(url).toContain('recEXIST001');
    expect(result.created).toBe(false);
  });

  // ── 404 fallback ────────────────────────────────────────────────────────────

  it('falls back to POST when PATCH returns 404', async () => {
    // First call: PATCH → 404; second call: POST → 200
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(404))
      .mockResolvedValueOnce(makeOkResponse('recFALLBACK001'));

    const result = await upsertAirtableResidente(TENANT, 'recDELETED001');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, patchOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    const [, postOptions]  = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(patchOptions.method).toBe('PATCH');
    expect(postOptions.method).toBe('POST');
    expect(result.airtableRecordId).toBe('recFALLBACK001');
    expect(result.created).toBe(true);
  });

  // ── Field mapping ───────────────────────────────────────────────────────────

  it('maps field names correctly in the request body', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse('recFIELD001'));
    await upsertAirtableResidente(TENANT, null);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { fields: Record<string, string> };

    expect(body.fields['Nombre(s)']).toBe('María');
    expect(body.fields['Apellidos']).toBe('García');
    expect(body.fields['Correo electrónico']).toBe('maria@example.com');
    expect(body.fields['Número celular']).toBe('999888777');
    expect(body.fields['N° DNI']).toBe('12345678');
    expect(body.fields['Fecha de nacimiento']).toBe('1990-05-15');
  });

  it('omits null/undefined dni and birth_date from payload', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse('recOMIT001'));
    await upsertAirtableResidente({
      first_name: 'Test',
      last_name:  'User',
      email:      'test@test.com',
      phone:      '000000000',
      dni:        null,
      birth_date: null,
    }, null);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { fields: Record<string, unknown> };
    expect(body.fields['N° DNI']).toBeUndefined();
    expect(body.fields['Fecha de nacimiento']).toBeUndefined();
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  it('throws on 5xx response from POST', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500));
    await expect(upsertAirtableResidente(TENANT, null)).rejects.toThrow(/500/);
  });

  it('throws on 5xx response from PATCH (non-404)', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503));
    await expect(upsertAirtableResidente(TENANT, 'recFAIL001')).rejects.toThrow(/503/);
  });

  it('throws when env vars are missing', async () => {
    clearEnv();
    await expect(upsertAirtableResidente(TENANT, null)).rejects.toThrow();
  });
});
