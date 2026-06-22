/**
 * GET /api/airtable-attachment?snapshot_id={id}&att_id={attId}
 *
 * Airtable attachment proxy — serves a refreshed Airtable CDN URL for a room
 * snapshot attachment, without exposing the Airtable PAT to the client.
 *
 * Auth: authenticated org-scoped (admin only — tenants get 404).
 *
 * Flow:
 *   1. Auth — requireAdmin() (admin only; tenant gets 404 per spec AC15).
 *   2. Validate query params (snapshot_id UUID, att_id non-empty string).
 *   3. Fetch airtable_snapshots row — org scoped (IDOR defense).
 *   4. Check 1h in-process cache by att_id — return cached redirect if still valid.
 *   5. Extract the attachment from data.fields[photoField][att_id].
 *   6. Return 302 redirect to refreshed Airtable CDN URL + update cache.
 *
 * Security:
 *   - NEVER exposes AIRTABLE_PAT to the client — all Airtable access is server-side.
 *   - IDOR: snapshot_id must belong to admin's org_id (query filters on org_id).
 *   - Tenant or cross-org → 404 (prevents enumeration).
 *   - Rate limit: 30 req/min per user (reuse mutationRateLimit key — same ceiling).
 *   - Cache: in-process Map with 1h TTL — reduces Airtable API pressure.
 *
 * Error codes: UNAUTHORIZED, NOT_FOUND, AIRTABLE_FETCH_FAILED.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { airtableSnapshots } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { log } from '@/lib/log';
import { actionRateLimit } from '@/lib/ratelimit';
import { AirtableAttachmentSchema } from '@/lib/schemas/airtable';
import { resolvePhotoFieldName } from '@/lib/airtable/normalize';
import { z } from 'zod';

const ONE_MINUTE_MS = 60_000;
const CACHE_TTL_MS = 60 * 60_000; // 1 hour

// ---------------------------------------------------------------------------
// In-process cache (Map<att_id, { url: string; expiresAt: number }>)
// Per-instance only — acceptable on Hobby plan (typically single instance).
// ---------------------------------------------------------------------------

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const attachmentCache = new Map<string, CacheEntry>();

// Clean stale entries every 10 minutes to prevent unbounded growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attachmentCache.entries()) {
      if (now > entry.expiresAt) attachmentCache.delete(key);
    }
  }, 10 * ONE_MINUTE_MS);
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  snapshot_id: z.string().uuid(),
  att_id: z.string().min(1).max(64),
});

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Auth — admin only; tenant → 404 (spec AC15: tenant gets 404)
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 });
  }

  // Tenant access returns 404 (not 403 — prevents enumeration per IC4)
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, { status: 404 });
  }

  // 2. Rate limit (30 req/min per admin)
  const rl = actionRateLimit(`airtable-att:${ctx.userId}`, 30, ONE_MINUTE_MS);
  if (!rl.success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait.' } }, { status: 429 });
  }

  // 3. Validate query params
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'BAD_PATH', message: 'Invalid query parameters', details: parsed.error.flatten() } }, { status: 400 });
  }

  const { snapshot_id, att_id } = parsed.data;

  // 4. Check in-process cache
  const cacheKey = `${snapshot_id}:${att_id}`;
  const cached = attachmentCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.redirect(cached.url, { status: 302 });
  }

  // 5. Fetch snapshot from DB — org scoped (IDOR: admin can only see their org) — Drizzle (AC1, AC8)
  const snapshotRows = await db
    .select({ id: airtableSnapshots.id, orgId: airtableSnapshots.orgId, data: airtableSnapshots.data })
    .from(airtableSnapshots)
    .where(and(eq(airtableSnapshots.id, snapshot_id), eq(airtableSnapshots.orgId, ctx.orgId)))
    .limit(1);

  const snapshot = snapshotRows[0];
  if (!snapshot) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, { status: 404 });
  }

  // 6. Extract attachment from snapshot data
  // The data column is JSONB — structure: { fields: { [fieldName]: AirtableAttachment[] } }
  let attachmentUrl: string | null = null;

  try {
    const data = snapshot.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, { status: 404 });
    }

    // Try the configurable photo field name first, then fall back to common alternatives
    const photoFieldName = resolvePhotoFieldName();
    const candidateFields = [
      photoFieldName,
      'Photos',
      'Images',
      'Attachments',
      'Cover Image',
      'Photo',
    ];

    const fields = (data as { fields?: Record<string, unknown> }).fields ?? data;

    for (const fieldName of candidateFields) {
      const fieldValue = (fields as Record<string, unknown>)[fieldName];
      if (!Array.isArray(fieldValue)) continue;

      for (const item of fieldValue) {
        const parsedAtt = AirtableAttachmentSchema.safeParse(item);
        if (parsedAtt.success && parsedAtt.data.id === att_id) {
          attachmentUrl = parsedAtt.data.url;
          break;
        }
      }

      if (attachmentUrl) break;
    }
  } catch (extractErr) {
    log.error('[airtable-attachment] data extraction error', { snapshot_id, error: String(extractErr).slice(0, 100) });
    return NextResponse.json({ error: { code: 'AIRTABLE_FETCH_FAILED', message: 'Failed to extract attachment' } }, { status: 502 });
  }

  if (!attachmentUrl) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Attachment not found in snapshot' } }, { status: 404 });
  }

  // 7. Update cache and redirect
  attachmentCache.set(cacheKey, {
    url: attachmentUrl,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return NextResponse.redirect(attachmentUrl, { status: 302 });
}
