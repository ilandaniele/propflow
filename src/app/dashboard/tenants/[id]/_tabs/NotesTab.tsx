import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { NotesTabClient } from './NotesTabClient';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches internal notes for the given tenant,
 * then renders the client-side <NotesTabClient> (which needs 'use client' for
 * useActionState / form interaction).
 *
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function NotesTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data } = await supabase
    .from('internal_notes')
    .select('id, content, created_by, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  const notes = data ?? [];

  return <NotesTabClient notes={notes} tenantId={tenantId} />;
}
