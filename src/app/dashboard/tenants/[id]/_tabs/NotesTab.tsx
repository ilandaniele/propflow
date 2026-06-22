import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { internalNotes } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
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

  const rows = await db
    .select({
      id:        internalNotes.id,
      content:   internalNotes.content,
      createdBy: internalNotes.createdBy,
      createdAt: internalNotes.createdAt,
    })
    .from(internalNotes)
    .where(and(eq(internalNotes.tenantId, tenantId), eq(internalNotes.orgId, ctx.orgId)))
    .orderBy(desc(internalNotes.createdAt))
    .limit(50);

  // Map to snake_case shape expected by NotesTabClient (legacy prop contract)
  const notes = rows.map((n) => ({
    id:         n.id,
    content:    n.content,
    created_by: n.createdBy,
    created_at: n.createdAt ? String(n.createdAt) : null,
  }));

  return <NotesTabClient notes={notes as never} tenantId={tenantId} />;
}
