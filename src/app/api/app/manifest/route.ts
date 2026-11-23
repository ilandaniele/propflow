export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getProfile } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { buildManifest, type ManifestViewer } from '@/lib/pwa/manifest';

async function viewer(): Promise<ManifestViewer | null> {
  const profile = await getProfile().catch(() => null);
  if (!profile) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, profile.org_id)).limit(1);
  return org ? { role: profile.role, orgName: org.name } : null;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(buildManifest(await viewer()), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
