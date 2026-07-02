import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage/index';
import { isSafeOrgScopedPath } from '@/lib/storage/path';
import { z } from 'zod';

const QuerySchema = z.object({
  path: z.string().min(1).max(500),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  const user = session?.user;

  if (!user?.id) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = QuerySchema.safeParse(searchParams);

  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid path' } }, { status: 400 });
  }

  const storagePath = parsed.data.path;

  // Verify the user has access to the incident this photo belongs to — Drizzle (AC1)
  const profileRows = await db
    .select({ orgId: profiles.orgId })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Profile not found' } }, { status: 401 });
  }

  // Path must be a clean {org_id}/{incident_id}/{file} scoped to the caller's org
  // (rejects .. and prefix tricks — AC8: orgId isolation, ASVS V12.3.1).
  if (!isSafeOrgScopedPath(storagePath, profile.orgId)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, { status: 404 });
  }

  // Generate signed URL via Tigris storage lib (AC1: no supabase.storage calls)
  try {
    const signedUrl = await getSignedUrl('incident-photos', storagePath, 3600);
    return NextResponse.json({ signedUrl });
  } catch {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } }, { status: 404 });
  }
}
