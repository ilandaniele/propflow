import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { whatsappConversations, tenants } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'WhatsApp Inbox' };

export default async function WhatsAppInboxPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('whatsapp');

  const conversations = await db
    .select({
      id:               whatsappConversations.id,
      externalPhone:    whatsappConversations.externalPhone,
      lastMessageAt:    whatsappConversations.lastMessageAt,
      unreadCountAdmin: whatsappConversations.unreadCountAdmin,
      tenantId:         whatsappConversations.tenantId,
      tenantFullName:   tenants.fullName,
    })
    .from(whatsappConversations)
    .leftJoin(tenants, eq(tenants.id, whatsappConversations.tenantId))
    .where(eq(whatsappConversations.orgId, ctx.orgId))
    .orderBy(desc(whatsappConversations.lastMessageAt))
    .limit(50);

  const isMock = !process.env.WHATSAPP_PROVIDER || process.env.WHATSAPP_PROVIDER === 'mock';

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')} {t('inbox')}</h1>
      </div>

      {isMock && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-amber-800">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
          </svg>
          <span>{t('inboxBannerText')}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {conversations.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {t('noConversationsDesc')}
          </div>
        ) : (
          conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/dashboard/whatsapp/${conv.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {conv.tenantFullName ?? conv.externalPhone}
                </p>
                {conv.tenantFullName && (
                  <p className="text-xs text-slate-400">{conv.externalPhone}</p>
                )}
                {conv.lastMessageAt && (
                  <p className="text-xs text-slate-400">
                    {new Date(conv.lastMessageAt).toLocaleString()}
                  </p>
                )}
              </div>
              {conv.unreadCountAdmin > 0 && (
                <Badge variant="danger">{conv.unreadCountAdmin}</Badge>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
