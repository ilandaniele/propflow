import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { generateApiKey } from '@/lib/api-keys/token';
import { sha256 } from '@/lib/crypto/hash';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440001';
const KEY_ID = '550e8400-e29b-41d4-a716-446655440002';
const PROPERTY_ID = '550e8400-e29b-41d4-a716-446655440003';

const mockClaim = vi.fn();
vi.mock('@/lib/api-keys/queries', () => ({ claimActiveApiKey: (...a: unknown[]) => mockClaim(...a) }));

const mockRateLimit = vi.fn();
vi.mock('@/lib/ratelimit', () => ({ actionRateLimit: (...a: unknown[]) => mockRateLimit(...a) }));

const mockListProperties = vi.fn();
const mockListUnits = vi.fn();
const mockListTenants = vi.fn();
const mockListPayments = vi.fn();
vi.mock('@/lib/public-api/queries', () => ({
  listPropertiesForApi: (...a: unknown[]) => mockListProperties(...a),
  listUnitsForApi: (...a: unknown[]) => mockListUnits(...a),
  listTenantsForApi: (...a: unknown[]) => mockListTenants(...a),
  listPaymentsForApi: (...a: unknown[]) => mockListPayments(...a),
}));

const { token } = generateApiKey();

function post(body: unknown, authorization: string | null = `Bearer ${token}`) {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (authorization) headers.authorization = authorization;
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params });

async function call(body: unknown, authorization?: string | null) {
  const { POST } = await import('@/app/api/mcp/route');
  return POST(post(body, authorization));
}

function toolText(json: { result: { content: { type: string; text: string }[] } }) {
  expect(json.result.content[0].type).toBe('text');
  return JSON.parse(json.result.content[0].text);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClaim.mockResolvedValue({ id: KEY_ID, orgId: ORG_ID });
  mockRateLimit.mockReturnValue({ success: true, retryAfterMs: 0 });
});

describe('POST /api/mcp', () => {
  it('401 without a bearer token and never touches the DB', async () => {
    const res = await call(rpc('initialize', {}), null);
    expect(res.status).toBe(401);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('401 for an unknown or revoked key', async () => {
    mockClaim.mockResolvedValue(null);
    const res = await call(rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(mockClaim).toHaveBeenCalledWith(sha256(token));
  });

  it('429 when the key exceeds its rate limit', async () => {
    mockRateLimit.mockReturnValue({ success: false, retryAfterMs: 1000 });
    const res = await call(rpc('tools/call', { name: 'list_properties', arguments: {} }));
    expect(res.status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledWith(`api-key:${KEY_ID}`, expect.any(Number), 60_000);
    expect(mockListProperties).not.toHaveBeenCalled();
  });

  it('405 on GET (no SSE stream)', async () => {
    const { GET } = await import('@/app/api/mcp/route');
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('initialize negotiates the protocol and advertises tools only', async () => {
    const res = await call(rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(json).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'propflow' } },
    });
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  it('initialize falls back to the latest version for unknown protocol versions', async () => {
    const json = await (await call(rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } }))).json();
    expect(json.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.result.protocolVersion).not.toBe('1999-01-01');
  });

  it('202 with no body for notifications/initialized', async () => {
    const res = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('ping returns an empty result', async () => {
    expect(await (await call(rpc('ping', undefined, 'p1'))).json()).toEqual({ jsonrpc: '2.0', id: 'p1', result: {} });
  });

  it('tools/list exposes the four read-only tools with JSON schemas', async () => {
    const json = await (await call(rpc('tools/list'))).json();
    const tools = json.result.tools as { name: string; inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] }; annotations?: { readOnlyHint?: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(['list_payments', 'list_properties', 'list_tenants', 'list_units']);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toHaveProperty('limit');
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    const payments = tools.find((t) => t.name === 'list_payments')!;
    expect(payments.inputSchema.required).toEqual(['month']);
    expect(payments.inputSchema.properties).toHaveProperty('status');
    expect(tools.find((t) => t.name === 'list_units')!.inputSchema.properties).toHaveProperty('propertyId');
  });

  it('tools/call list_payments scopes to the key org and paginates', async () => {
    mockListPayments.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const json = await (await call(rpc('tools/call', {
      name: 'list_payments',
      arguments: { month: '2026-11', status: 'approved', limit: 2, offset: 4 },
    }))).json();
    expect(json.result.isError).toBeFalsy();
    expect(toolText(json)).toEqual({ data: [{ id: 'a' }, { id: 'b' }], pagination: { limit: 2, offset: 4, hasMore: true } });
    expect(mockListPayments).toHaveBeenCalledWith(
      ORG_ID,
      { limit: 2, offset: 4 },
      expect.objectContaining({ month: '2026-11', status: 'approved' }),
    );
  });

  it('tools/call list_units passes the optional propertyId filter', async () => {
    mockListUnits.mockResolvedValue([]);
    const json = await (await call(rpc('tools/call', { name: 'list_units', arguments: { propertyId: PROPERTY_ID } }))).json();
    expect(toolText(json)).toEqual({ data: [], pagination: { limit: 50, offset: 0, hasMore: false } });
    expect(mockListUnits).toHaveBeenCalledWith(ORG_ID, { limit: 50, offset: 0 }, expect.objectContaining({ propertyId: PROPERTY_ID }));
  });

  it('tools/call without arguments uses default pagination', async () => {
    mockListTenants.mockResolvedValue([{ id: 't1', fullName: 'Ana' }]);
    const json = await (await call(rpc('tools/call', { name: 'list_tenants' }))).json();
    expect(toolText(json).data).toEqual([{ id: 't1', fullName: 'Ana' }]);
    expect(mockListTenants).toHaveBeenCalledWith(ORG_ID, { limit: 50, offset: 0 }, expect.any(Object));
  });

  it.each([
    ['missing month', { name: 'list_payments', arguments: {} }],
    ['bad month', { name: 'list_payments', arguments: { month: '2026-13' } }],
    ['bad status', { name: 'list_payments', arguments: { month: '2026-11', status: 'paid' } }],
    ['limit too big', { name: 'list_properties', arguments: { limit: 500 } }],
    ['bad propertyId', { name: 'list_units', arguments: { propertyId: 'nope' } }],
  ])('tool argument validation error is reported with isError (%s)', async (_label, params) => {
    const json = await (await call(rpc('tools/call', params))).json();
    expect(json.error).toBeUndefined();
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].type).toBe('text');
    expect(mockListPayments).not.toHaveBeenCalled();
    expect(mockListProperties).not.toHaveBeenCalled();
    expect(mockListUnits).not.toHaveBeenCalled();
  });

  it.each([
    ['missing name', { arguments: {} }],
    ['non-object arguments', { name: 'list_properties', arguments: 'x' }],
    ['no params', undefined],
  ])('-32602 for malformed tools/call params (%s)', async (_label, params) => {
    const json = await (await call(rpc('tools/call', params))).json();
    expect(json.error.code).toBe(-32602);
  });

  it('-32602 for an unknown tool', async () => {
    const json = await (await call(rpc('tools/call', { name: 'delete_everything', arguments: {} }))).json();
    expect(json).toMatchObject({ id: 1, error: { code: -32602 } });
  });

  it('-32601 for an unknown method', async () => {
    const json = await (await call(rpc('resources/list'))).json();
    expect(json).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32601 } });
  });

  it('-32700 with HTTP 400 for malformed JSON', async () => {
    const res = await call('{"jsonrpc": "2.0", ');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });

  it('generic error when a query fails, no internals leaked', async () => {
    mockListProperties.mockRejectedValue(new Error('D1 exploded'));
    const res = await call(rpc('tools/call', { name: 'list_properties', arguments: {} }));
    const body = await res.text();
    expect(body).not.toContain('D1 exploded');
    expect(JSON.parse(body)).toMatchObject({ error: { code: -32603 } });
  });
});
