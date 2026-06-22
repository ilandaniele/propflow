import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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

  const t = await getTranslations('tenantTabs.whatsappTab');

  const convRows = await db
    .select({ id: whatsappConversations.id, externalPhone: whatsappConversations.externalPhone })
    .from(whatsappConversations)
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.orgId, ctx.orgId)))
    .limit(1);

  const conversation = convRows[0] ?? null;

  if (!conversation) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
          <p className="text-sm text-slate-400">{t('noConversation')}</p>
          <p className="text-xs text-slate-400 mt-1">{t('addPhoneHint')}</p>
        </Card>
      </div>
    );
  }

  const messages = await db
    .select({
      id:             whatsappMessages.id,
      direction:      whatsappMessages.direction,
      body:           whatsappMessages.body,
      classification: whatsappMessages.classification,
      status:         whatsappMessages.status,
      createdAt:      whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.conversationId, conversation.id), eq(whatsappMessages.orgId, ctx.orgId)))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(100);

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-500">
          {t('conversationWith')}{' '}
          <span className="font-medium text-slate-700">
            {conversation.externalPhone.slice(0, 4)}****
          </span>
        </div>
        <Link
          href={`/dashboard/whatsapp/${conversation.id}`}
          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
        >
          {t('openFullConversation')} →
        </Link>
      </div>

      <Card>
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">{t('noMessages')}</p>
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
                  <p>{m.body ?? t('attachment')}</p>
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
                    {m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : '—'}
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
