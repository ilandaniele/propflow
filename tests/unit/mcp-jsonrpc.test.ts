import { describe, it, expect, vi } from 'vitest';
import { dispatchJsonRpc, JsonRpcError, JSONRPC_ERRORS } from '@/lib/mcp/jsonrpc';

vi.mock('@/lib/log', () => ({ log: { error: vi.fn() } }));

const methods = {
  echo: (params: unknown) => ({ params }),
  fail: () => {
    throw new JsonRpcError(JSONRPC_ERRORS.INVALID_PARAMS, 'bad params');
  },
  crash: () => {
    throw new Error('secret internals');
  },
  'notifications/initialized': vi.fn(),
};

describe('dispatchJsonRpc', () => {
  it('returns the handler result with the request id', async () => {
    const res = await dispatchJsonRpc({ jsonrpc: '2.0', id: 7, method: 'echo', params: { a: 1 } }, methods);
    expect(res).toEqual({ jsonrpc: '2.0', id: 7, result: { params: { a: 1 } } });
  });

  it('accepts string ids', async () => {
    const res = await dispatchJsonRpc({ jsonrpc: '2.0', id: 'x', method: 'echo' }, methods);
    expect(res).toMatchObject({ id: 'x', result: { params: undefined } });
  });

  it('-32601 for unknown methods, including inherited object keys', async () => {
    for (const method of ['nope', 'toString', '__proto__', 'constructor']) {
      const res = await dispatchJsonRpc({ jsonrpc: '2.0', id: 1, method }, methods);
      expect(res).toMatchObject({ id: 1, error: { code: -32601 } });
    }
  });

  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['batch array', [{ jsonrpc: '2.0', id: 1, method: 'echo' }]],
    ['wrong version', { jsonrpc: '1.0', id: 1, method: 'echo' }],
    ['non-string method', { jsonrpc: '2.0', id: 1, method: 5 }],
    ['null id', { jsonrpc: '2.0', id: null, method: 'echo' }],
    ['object id', { jsonrpc: '2.0', id: {}, method: 'echo' }],
  ])('-32600 for an invalid request (%s)', async (_label, message) => {
    const res = await dispatchJsonRpc(message, methods);
    expect(res).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } });
  });

  it('maps JsonRpcError to its code', async () => {
    const res = await dispatchJsonRpc({ jsonrpc: '2.0', id: 2, method: 'fail' }, methods);
    expect(res).toEqual({ jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad params' } });
  });

  it('hides unexpected errors behind -32603', async () => {
    const res = await dispatchJsonRpc({ jsonrpc: '2.0', id: 3, method: 'crash' }, methods);
    expect(res).toMatchObject({ id: 3, error: { code: -32603 } });
    expect(JSON.stringify(res)).not.toContain('secret internals');
  });

  it('runs notifications without producing a response', async () => {
    const res = await dispatchJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, methods);
    expect(res).toBeNull();
    expect(methods['notifications/initialized']).toHaveBeenCalled();
  });

  it('never answers notifications, even unknown or failing ones', async () => {
    expect(await dispatchJsonRpc({ jsonrpc: '2.0', method: 'notifications/unknown' }, methods)).toBeNull();
    expect(await dispatchJsonRpc({ jsonrpc: '2.0', method: 'crash' }, methods)).toBeNull();
  });

  it('ignores client responses', async () => {
    expect(await dispatchJsonRpc({ jsonrpc: '2.0', id: 9, result: {} }, methods)).toBeNull();
  });
});
