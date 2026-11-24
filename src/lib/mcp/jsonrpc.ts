import { log } from '@/lib/log';

export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

type JsonRpcId = string | number;

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId | null; error: { code: number; message: string } };

export type JsonRpcMethods = Record<string, (params: unknown) => unknown>;

export class JsonRpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

export function jsonRpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isClientResponse = (message: Record<string, unknown>) =>
  !('method' in message) && 'id' in message && ('result' in message || 'error' in message);

async function invoke(methods: JsonRpcMethods, method: string, params: unknown) {
  if (!Object.hasOwn(methods, method)) throw new JsonRpcError(JSONRPC_ERRORS.METHOD_NOT_FOUND, 'Method not found');
  return methods[method](params);
}

function toErrorResponse(id: JsonRpcId, method: string, error: unknown): JsonRpcResponse {
  if (error instanceof JsonRpcError) return jsonRpcError(id, error.code, error.message);
  log.error('mcp.method_failed', { method, error: error instanceof Error ? error.message : String(error) });
  return jsonRpcError(id, JSONRPC_ERRORS.INTERNAL_ERROR, 'Internal error');
}

export async function dispatchJsonRpc(message: unknown, methods: JsonRpcMethods): Promise<JsonRpcResponse | null> {
  if (isRecord(message) && isClientResponse(message)) return null;
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(null, JSONRPC_ERRORS.INVALID_REQUEST, 'Invalid Request');
  }

  const { method, params } = message;
  if (!('id' in message)) {
    await invoke(methods, method, params).catch(() => undefined);
    return null;
  }

  const { id } = message;
  if (typeof id !== 'string' && typeof id !== 'number') {
    return jsonRpcError(null, JSONRPC_ERRORS.INVALID_REQUEST, 'Invalid Request');
  }

  try {
    return { jsonrpc: '2.0', id, result: await invoke(methods, method, params) };
  } catch (error) {
    return toErrorResponse(id, method, error);
  }
}
