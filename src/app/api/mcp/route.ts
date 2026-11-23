import { NextRequest, NextResponse } from 'next/server';
import { apiError, authenticateApiKey } from '@/lib/public-api/handler';
import { dispatchJsonRpc, jsonRpcError, JSONRPC_ERRORS } from '@/lib/mcp/jsonrpc';
import { mcpMethods } from '@/lib/mcp/server';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

async function readJson(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse(await request.text()) };
  } catch {
    return { ok: false };
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);
    if (!auth.ok) return auth.response;

    const body = await readJson(request);
    if (!body.ok) {
      return NextResponse.json(jsonRpcError(null, JSONRPC_ERRORS.PARSE_ERROR, 'Parse error'), { status: 400, headers: NO_STORE });
    }

    const response = await dispatchJsonRpc(body.value, mcpMethods(auth.orgId));
    if (!response) return new NextResponse(null, { status: 202 });
    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    log.error('mcp.failed', { error: error instanceof Error ? error.message : String(error) });
    return apiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
