import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { getOrgWebChannel, getWhatsAppDisplayPhone } from '@/lib/widget/channel';
import { getAppOrigin } from '@/lib/widget/origins';
import { WidgetSettingsForm } from './_components/WidgetSettingsForm';
import { RotateKeyForm } from './_components/RotateKeyForm';
import { PublicPagesForm } from './_components/PublicPagesForm';

export const metadata: Metadata = { title: 'Agente IA — Widget web' };

export default async function AgentWidgetPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('agentWidget');

  const [orgRow, config, channel, whatsappDisplayPhone] = await Promise.all([
    db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1),
    getOrCreateAgentConfig(ctx.orgId),
    getOrgWebChannel(ctx.orgId),
    getWhatsAppDisplayPhone(ctx.orgId),
  ]);

  const orgSlug = orgRow[0]?.slug ?? null;
  let appOrigin: string | null = null;
  try { appOrigin = getAppOrigin(); } catch { appOrigin = null; }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
      </div>

      {!whatsappDisplayPhone && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          {t('noDisplayPhoneWarning')}
        </div>
      )}

      <PublicPagesForm enabled={config.publicPagesEnabled} orgSlug={orgSlug} appOrigin={appOrigin} />

      <WidgetSettingsForm
        enabled={channel?.enabled ?? false}
        allowedOrigins={channel?.allowedOrigins ?? []}
        dailyMessageCap={channel?.dailyMessageCap ?? 300}
        dailySessionCap={channel?.dailySessionCap ?? 150}
        greeting={channel?.greeting ?? ''}
        accentColor={channel?.accentColor ?? ''}
        whatsappDisplayPhone={whatsappDisplayPhone}
      />

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">{t('embedTitle')}</h2>
        {channel?.publicKey && appOrigin ? (
          <>
            <p className="text-xs text-slate-500">{t('embedHint')}</p>
            <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 overflow-x-auto">
              {`<script src="${appOrigin}/widget.js" data-key="${channel.publicKey}" async></script>`}
            </pre>
          </>
        ) : (
          <p className="text-sm text-slate-400">{t('embedEmptyState')}</p>
        )}
        <RotateKeyForm />
      </div>
    </div>
  );
}
