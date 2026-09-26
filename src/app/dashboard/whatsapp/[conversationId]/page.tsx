import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { whatsappConversations, whatsappMessages, tenants } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { SendMessageForm } from '../_components/SendMessageForm';
import { MarkReadOnView } from '../_components/MarkReadOnView';

export const metadata: Metadata = { title: 'WhatsApp' };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('whatsapp');
  const { conversationId } = await params;

  // IDOR guard: conversation must belong to this org.
  const convRows = await db
    .select({
      id: whatsappConversations.id,
      externalPhone: whatsappConversations.externalPhone,
      tenantId: whatsappConversations.tenantId,
      tenantFullName: tenants.fullName,
    })
    .from(whatsappConversations)
    .leftJoin(tenants, eq(tenants.id, whatsappConversations.tenantId))
    .where(and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.orgId, ctx.orgId)))
    .limit(1);

  const conversation = convRows[0];
  if (!conversation) notFound();

  const messages = await db
    .select({
      id: whatsappMessages.id,
      direction: whatsappMessages.direction,
      body: whatsappMessages.body,
      classification: whatsappMessages.classification,
      status: whatsappMessages.status,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.conversationId, conversationId), eq(whatsappMessages.orgId, ctx.orgId)))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(100);

  const orderedMessages = [...messages].reverse();

  return (
    <div className="max-w-2xl space-y-4">
      <MarkReadOnView conversationId={conversationId} />

      <div className="flex items-center gap-2">
        <Link href="/dashboard/whatsapp" className="text-sm text-brand-600 hover:text-brand-800">
          {t('backToInbox')}
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="text-sm text-slate-500">
          {conversation.tenantFullName ?? t('unknownTenant')}
          <span className="text-slate-400"> — {conversation.externalPhone}</span>
        </div>

        {orderedMessages.length === 0 ? (
          <p className="text-sm text-slate-400">{t('noMessages')}</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {orderedMessages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-xs px-3 py-2 rounded-lg text-sm',
                    m.direction === 'outbound' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-900',
                  ].join(' ')}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body ?? `[${m.classification ?? 'attachment'}]`}</p>
                  <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-brand-200' : 'text-slate-400'}`}>
                    {m.createdAt ? new Date(m.createdAt).toLocaleString() : '—'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <SendMessageForm conversationId={conversationId} />
      </div>
    </div>
  );
}
