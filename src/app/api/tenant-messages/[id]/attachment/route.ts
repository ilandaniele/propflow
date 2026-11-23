export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import { log } from '@/lib/log';
import { actionRateLimit } from '@/lib/ratelimit';
import { findMessageAttachment } from '@/lib/messages/queries';
import { MESSAGE_ATTACHMENT_BUCKET } from '@/lib/messages/attachment';
import { getSignedUrl } from '@/lib/storage/index';
import { isSafeOrgScopedPath } from '@/lib/storage/path';

const SIGNED_URL_TTL_SECONDS = 300;
const MessageIdParam = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }
  if (!actionRateLimit(`tenant-message-attachment:${ctx.userId}`, 60, 60_000).success) {
    return NextResponse.json(Errors.RATE_LIMITED(), { status: 429 });
  }

  const parsed = MessageIdParam.safeParse((await params).id);
  if (!parsed.success) return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });

  const attachment = await findMessageAttachment({
    messageId: parsed.data,
    orgId: ctx.orgId,
    senderId: ctx.role === 'tenant' ? ctx.userId : undefined,
  });
  if (!attachment || !isSafeOrgScopedPath(attachment.key, ctx.orgId)) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  try {
    const url = await getSignedUrl(MESSAGE_ATTACHMENT_BUCKET, attachment.key, SIGNED_URL_TTL_SECONDS);
    const response = NextResponse.redirect(url, 302);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    log.error('tenant-messages.attachment_url_failed', { err: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }
}
