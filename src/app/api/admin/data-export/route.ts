export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { dataExportRateLimit } from '@/lib/ratelimit';
import { orgDataZip } from '@/lib/data-export/export';
import { toReadableStream } from '@/lib/data-export/zip';
import { log } from '@/lib/log';

export async function GET(): Promise<Response> {
  let ctx;
  try { ctx = await requireAdmin(); } catch (e) {
    const forbidden = e instanceof Error && e.message === 'FORBIDDEN';
    return NextResponse.json(
      { error: { code: forbidden ? 'FORBIDDEN' : 'UNAUTHORIZED', message: 'Admin access required.' } },
      { status: forbidden ? 403 : 401 },
    );
  }

  if (!dataExportRateLimit(ctx.orgId).success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429 });
  }

  const now = new Date();
  log.adminAction(ctx.userId, 'org.data_export', 'organization', ctx.orgId);
  const body = toReadableStream(orgDataZip(ctx.orgId, now), (e) => {
    log.error('[api/admin/data-export] stream failed', { orgId: ctx.orgId, error: e instanceof Error ? e.message : 'unknown' });
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="propflow-datos-${now.toISOString().slice(0, 10)}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
