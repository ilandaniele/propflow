import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'WhatsApp Inbox' };

export default async function WhatsAppInboxPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data: conversations } = await supabase
    .from('whatsapp_conversations')
    .select(`
      id, external_phone, last_message_at, unread_count_admin, tenant_id,
      tenant:tenants(full_name)
    `)
    .eq('org_id', ctx.orgId)
    .order('last_message_at', { ascending: false })
    .limit(50);

  const isMock = !process.env.WHATSAPP_PROVIDER || process.env.WHATSAPP_PROVIDER === 'mock';

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">WhatsApp Inbox</h1>
      </div>

      {/* Mock provider banner */}
      {isMock && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-amber-800">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
          </svg>
          <span><strong>Mock Provider Active</strong> — messages are NOT delivered to real WhatsApp. Configure <code>WHATSAPP_PROVIDER</code> to switch to a real provider.</span>
        </div>
      )}

      {/* Conversations list */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(conversations ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No conversations yet. Incoming WhatsApp messages will appear here.
          </div>
        ) : (
          (conversations ?? []).map((conv) => {
            const tenantName = (conv.tenant as unknown as { full_name: string | null } | null)?.full_name;
            return (
              <Link
                key={conv.id}
                href={`/dashboard/whatsapp/${conv.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {tenantName ?? 'Unknown tenant'}
                    </p>
                    {conv.unread_count_admin > 0 && (
                      <Badge variant="danger">{conv.unread_count_admin} unread</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {conv.last_message_at
                      ? new Date(conv.last_message_at).toLocaleString()
                      : 'No messages yet'}
                  </p>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
