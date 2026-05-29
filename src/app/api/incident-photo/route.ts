import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const QuerySchema = z.object({
  path: z.string().min(1).max(500),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = QuerySchema.safeParse(searchParams);

  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid path' } }, { status: 400 });
  }

  const storagePath = parsed.data.path;

  // Extract org_id from path prefix: org_id/incident_id/filename
  const pathParts = storagePath.split('/');
  if (pathParts.length < 3) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Invalid path format' } }, { status: 404 });
  }

  // Verify the user has access to the incident this photo belongs to
  const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single();
  if (!profile) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Profile not found' } }, { status: 401 });
  }

  // The path must start with the user's org_id
  const orgIdFromPath = pathParts[0];
  if (orgIdFromPath !== profile.org_id) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, { status: 404 });
  }

  // Generate signed URL (60 min TTL)
  const { data, error } = await supabase.storage
    .from('incident-photos')
    .createSignedUrl(storagePath, 3600);

  if (error || !data) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } }, { status: 404 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
