import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getAgentSetupStatus } from '@/lib/agent/setup-status';
import { getWhatsAppTemplateStatus } from '@/app/actions/agent-templates';
import { getAppOrigin } from '@/lib/widget/origins';
import { ChecklistGroup, type ChecklistItemData } from './_components/ChecklistGroup';
import { WhatsAppChannelForm } from './_components/WhatsAppChannelForm';
import { TemplatesSection } from './_components/TemplatesSection';
import { CopyField } from './_components/CopyField';

export const metadata: Metadata = { title: 'Agente IA — Configuración inicial' };

const WHATSAPP_COMMAND = `flyctl secrets set -a propflow-app \\
  WHATSAPP_PROVIDER=meta \\
  WHATSAPP_ACCESS_TOKEN=<token permanente> \\
  WHATSAPP_PHONE_NUMBER_ID=<phone number id> \\
  WHATSAPP_BUSINESS_ACCOUNT_ID=<waba id> \\
  META_APP_SECRET=<app secret> \\
  WHATSAPP_WEBHOOK_VERIFY_TOKEN=<texto al azar>`;

const CALENDAR_COMMAND = `flyctl secrets set TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32) -a propflow-app`;

const EMAIL_COMMAND = `flyctl secrets set -a propflow-app \\
  RESEND_API_KEY=<key> \\
  RESEND_FROM_EMAIL="Propflow <no-reply@tudominio>"`;

const AGENT_COMMAND = `flyctl secrets set -a propflow-app ANTHROPIC_API_KEY=<key>`;

const VOICE_COMMAND = `flyctl secrets set -a propflow-app \\
  VAPI_API_KEY=<key> \\
  VAPI_WEBHOOK_SECRET=<secreto>`;

export default async function AgentSetupPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('agentSetup');

  const [status, templateStatusResult] = await Promise.all([
    getAgentSetupStatus(ctx.orgId),
    getWhatsAppTemplateStatus(),
  ]);

  const templates = templateStatusResult.data?.rows ?? [];
  const templatesFetchError = templateStatusResult.data?.fetchError ?? null;

  let appOrigin: string | null = null;
  try { appOrigin = getAppOrigin(); } catch { appOrigin = null; }
  const webhookUrl = `${appOrigin ?? 'https://propflow-app.fly.dev'}/api/whatsapp/webhook`;

  const canSyncTemplates =
    status.env.whatsappAccessToken && status.env.whatsappBusinessAccountId && !templatesFetchError;

  const whatsappItems: ChecklistItemData[] = [
    { key: 'provider', ok: status.env.whatsappProviderIsMeta, label: t('whatsappProviderLabel'), instruction: t('whatsappProviderInstruction') },
    { key: 'accessToken', ok: status.env.whatsappAccessToken, label: t('whatsappAccessTokenLabel'), instruction: t('whatsappAccessTokenInstruction') },
    { key: 'phoneNumberId', ok: status.env.whatsappPhoneNumberId, label: t('whatsappPhoneNumberIdLabel'), instruction: t('whatsappPhoneNumberIdInstruction') },
    { key: 'businessAccountId', ok: status.env.whatsappBusinessAccountId, label: t('whatsappBusinessAccountIdLabel'), instruction: t('whatsappBusinessAccountIdInstruction') },
    { key: 'appSecret', ok: status.env.metaAppSecret, label: t('metaAppSecretLabel'), instruction: t('metaAppSecretInstruction') },
    { key: 'verifyToken', ok: status.env.whatsappWebhookVerifyToken, label: t('webhookVerifyTokenLabel'), instruction: t('webhookVerifyTokenInstruction') },
    {
      key: 'channelBound',
      ok: status.whatsappChannel.configured,
      label: t('whatsappChannelBoundLabel'),
      instruction: t('whatsappChannelBoundInstruction'),
      extra: status.whatsappChannel.configured && !status.whatsappChannel.matchesEnvPhoneNumberId
        ? <p className="text-xs text-amber-700 mt-0.5">{t('whatsappChannelMismatchWarning')}</p>
        : undefined,
    },
    {
      key: 'inbound',
      ok: status.lastInboundWhatsAppAt !== null,
      label: t('whatsappInboundLabel'),
      instruction: t('whatsappInboundInstruction'),
      extra: status.lastInboundWhatsAppAt !== null
        ? <p className="text-xs text-slate-400 mt-0.5">{t('whatsappInboundLastAt', { date: status.lastInboundWhatsAppAt.toLocaleString('es-PE') })}</p>
        : undefined,
    },
  ];

  const agentItems: ChecklistItemData[] = [
    { key: 'anthropic', ok: status.env.anthropicApiKey, label: t('anthropicApiKeyLabel'), instruction: t('anthropicApiKeyInstruction') },
    { key: 'whatsappEnabled', ok: status.agent.whatsappEnabled, label: t('agentWhatsappEnabledLabel'), instruction: t('agentWhatsappEnabledInstruction') },
    {
      key: 'shadowMode',
      ok: true,
      label: `${t('agentShadowModeLabel')}: ${status.agent.shadowMode ? t('ok') : t('missing')}`,
      extra: <p className="text-xs text-slate-400 mt-0.5">{t('agentShadowModeNote')}</p>,
    },
    {
      key: 'publishedListings',
      ok: status.publishedListings > 0,
      label: t('publishedListingsLabel'),
      extra: <p className="text-xs text-slate-400 mt-0.5">{t('publishedListingsCount', { count: status.publishedListings })}</p>,
    },
  ];

  const calendarItems: ChecklistItemData[] = [
    { key: 'tokenKey', ok: status.env.tokenEncryptionKey, label: t('tokenEncryptionKeyLabel'), instruction: t('tokenEncryptionKeyInstruction') },
    {
      key: 'advisors',
      ok: status.advisorsWithAvailability > 0,
      label: t('advisorsAvailabilityLabel'),
      instruction: t('advisorsAvailabilityInstruction'),
      extra: <p className="text-xs text-slate-400 mt-0.5">{t('advisorsAvailabilityCount', { count: status.advisorsWithAvailability })}</p>,
    },
    {
      key: 'calendars',
      ok: status.activeCalendarConnections > 0,
      label: t('calendarConnectionsLabel'),
      instruction: t('calendarConnectionsInstruction'),
      extra: <p className="text-xs text-slate-400 mt-0.5">{t('calendarConnectionsCount', { count: status.activeCalendarConnections })}</p>,
    },
  ];

  const emailItems: ChecklistItemData[] = [
    { key: 'resendKey', ok: status.env.resendApiKey, label: t('resendApiKeyLabel'), instruction: t('resendApiKeyInstruction') },
    { key: 'resendFrom', ok: status.env.resendFromEmail, label: t('resendFromEmailLabel'), instruction: t('resendFromEmailInstruction') },
  ];

  const voiceItems: ChecklistItemData[] = [
    { key: 'vapiKey', ok: status.env.vapiApiKey, label: t('vapiApiKeyLabel'), instruction: t('vapiApiKeyInstruction') },
    { key: 'vapiWebhook', ok: status.env.vapiWebhookSecret, label: t('vapiWebhookSecretLabel'), instruction: t('vapiWebhookSecretInstruction') },
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('intro')}</p>
      </div>

      <ChecklistGroup title={t('groupWhatsapp')} items={whatsappItems} command={WHATSAPP_COMMAND}>
        <CopyField label={t('webhookUrlLabel')} value={webhookUrl} />
        <WhatsAppChannelForm
          phoneNumberId={status.whatsappChannel.phoneNumberId}
          displayPhoneE164={status.whatsappChannel.displayPhoneE164}
        />
      </ChecklistGroup>

      <TemplatesSection templates={templates} canSync={canSyncTemplates} fetchError={templatesFetchError} />

      <ChecklistGroup title={t('groupAgent')} items={agentItems} command={AGENT_COMMAND}>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/dashboard/agent/settings" className="text-brand-600 hover:underline">{t('linkSettings')}</Link>
          <Link href="/dashboard/agent/inbox" className="text-brand-600 hover:underline">{t('linkInbox')}</Link>
        </div>
      </ChecklistGroup>

      <ChecklistGroup title={t('groupCalendar')} items={calendarItems} command={CALENDAR_COMMAND}>
        <Link href="/dashboard/visits/availability" className="text-sm text-brand-600 hover:underline">
          {t('linkAvailability')}
        </Link>
      </ChecklistGroup>

      <ChecklistGroup title={t('groupEmail')} items={emailItems} command={EMAIL_COMMAND} />

      <ChecklistGroup title={t('groupVoice')} items={voiceItems} command={VOICE_COMMAND}>
        <p className="text-xs text-slate-400">{t('voicePostponedNote')}</p>
      </ChecklistGroup>
    </div>
  );
}
