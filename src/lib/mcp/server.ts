import { z } from 'zod';
import { JsonRpcError, JSONRPC_ERRORS, type JsonRpcMethods } from './jsonrpc';
import { findTool, toolDefinitions } from './tools';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const InitializeParams = z.object({ protocolVersion: z.string() });

const ToolCallParams = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

function parseParams<S extends z.ZodType>(schema: S, params: unknown): z.infer<S> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new JsonRpcError(JSONRPC_ERRORS.INVALID_PARAMS, 'Invalid params');
  return parsed.data;
}

function initialize(params: unknown) {
  const { protocolVersion } = parseParams(InitializeParams, params);
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion) ? protocolVersion : SUPPORTED_PROTOCOL_VERSIONS[0],
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'propflow', version: '1.0.0' },
    instructions: 'Read-only access to one Propflow organization: properties, units, tenants and payments.',
  };
}

async function callTool(orgId: string, params: unknown) {
  const { name, arguments: args } = parseParams(ToolCallParams, params);
  const tool = findTool(name);
  if (!tool) throw new JsonRpcError(JSONRPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${name.slice(0, 64)}`);
  return tool.run(orgId, args);
}

export function mcpMethods(orgId: string): JsonRpcMethods {
  return {
    initialize,
    'notifications/initialized': () => undefined,
    ping: () => ({}),
    'tools/list': () => ({ tools: toolDefinitions() }),
    'tools/call': (params) => callTool(orgId, params),
  };
}
