import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import Link from 'next/link';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches the WhatsApp conversation and recent
 * messages for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function WhatsAppTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('id, external_phone')
    .eq('tenant_id', tenantId)
    .eq('org_id', ctx.orgId)
    .limit(1)
    .single();

  if (!conversation) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader><CardTitle>WhatsApp</CardTitle></CardHeader>
          <p className="text-sm text-slate-400">No WhatsApp conversation for this tenant yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Add a WhatsApp phone number to the tenant profile to start receiving messages.
          </p>
        </Card>
      </div>
    );
  }

  const { data: msgs } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, body, classification, status, created_at')
    .eq('conversation_id', conversation.id)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(100);

  const messages = msgs ?? [];

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-500">
          Conversation with{' '}
          <span className="font-medium text-slate-700">
            {conversation.external_phone.slice(0, 4)}****
          </span>
        </div>
        <Link
          href={`/dashboard/whatsapp/${conversation.id}`}
          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
        >
          Open full conversation →
        </Link>
      </div>

      <Card>
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet</p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={[
                    'max-w-xs px-3 py-2 rounded-lg text-sm',
                    m.direction === 'outbound'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-900',
                  ].join(' ')}
                >
                  <p>{m.body ?? '(attachment)'}</p>
                  {m.classification && m.classification !== 'other' && (
                    <p
                      className={`text-xs mt-1 ${
                        m.direction === 'outbound' ? 'text-brand-200' : 'text-slate-400'
                      }`}
                    >
                      [{m.classification}]
                    </p>
                  )}
                  <p
                    className={`text-xs mt-1 ${
                      m.direction === 'outbound' ? 'text-brand-200' : 'text-slate-400'
                    }`}
                  >
                    {new Date(m.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
