/**
 * Aggregates everything /dashboard/agent/setup needs to render its checklist
 * — one read-only snapshot per org. Never returns secret values: for every
 * env var this only reports whether it's set (and, for WHATSAPP_PROVIDER,
 * whether it equals 'meta'), never the value itself.
 */

import { db } from '@/lib/db';
import {
  orgChannels,
  whatsappMessages,
  whatsappConversations,
  agentAvailability,
  calendarConnections,
  listings,
} from '@/lib/db/schema';
import { and, count, countDistinct, desc, eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';

export interface EnvPresence {
  whatsappProviderIsMeta: boolean;
  whatsappAccessToken: boolean;
  whatsappPhoneNumberId: boolean;
  whatsappBusinessAccountId: boolean;
  metaAppSecret: boolean;
  whatsappWebhookVerifyToken: boolean;
  tokenEncryptionKey: boolean;
  resendApiKey: boolean;
  resendFromEmail: boolean;
  anthropicApiKey: boolean;
  vapiApiKey: boolean;
  vapiWebhookSecret: boolean;
}

export interface WhatsAppChannelStatus {
  /** True when org_channels(channel='whatsapp') has a row for this org. */
  configured: boolean;
  /** org_channels.external_id — the Meta phone_number_id bound to this org. */
  phoneNumberId: string | null;
  /** org_channels.config.displayPhoneE164 — the +51… number shown to users. */
  displayPhoneE164: string | null;
  /** True when phoneNumberId equals env WHATSAPP_PHONE_NUMBER_ID — proves the row and the secret agree. */
  matchesEnvPhoneNumberId: boolean;
}

export interface AgentStatus {
  whatsappEnabled: boolean;
  webEnabled: boolean;
  voiceEnabled: boolean;
  shadowMode: boolean;
}

export interface SetupStatus {
  env: EnvPresence;
  whatsappChannel: WhatsAppChannelStatus;
  /** Last inbound WhatsApp message timestamp for the org — proves the webhook is actually receiving traffic. */
  lastInboundWhatsAppAt: Date | null;
  agent: AgentStatus;
  advisorsWithAvailability: number;
  activeCalendarConnections: number;
  publishedListings: number;
}

function presentEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

function getEnvPresence(): EnvPresence {
  return {
    whatsappProviderIsMeta:     process.env.WHATSAPP_PROVIDER === 'meta',
    whatsappAccessToken:        presentEnv('WHATSAPP_ACCESS_TOKEN'),
    whatsappPhoneNumberId:      presentEnv('WHATSAPP_PHONE_NUMBER_ID'),
    whatsappBusinessAccountId:  presentEnv('WHATSAPP_BUSINESS_ACCOUNT_ID'),
    metaAppSecret:              presentEnv('META_APP_SECRET'),
    whatsappWebhookVerifyToken: presentEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
    tokenEncryptionKey:         presentEnv('TOKEN_ENCRYPTION_KEY'),
    resendApiKey:               presentEnv('RESEND_API_KEY'),
    resendFromEmail:            presentEnv('RESEND_FROM_EMAIL'),
    anthropicApiKey:            presentEnv('ANTHROPIC_API_KEY'),
    vapiApiKey:                 presentEnv('VAPI_API_KEY'),
    vapiWebhookSecret:          presentEnv('VAPI_WEBHOOK_SECRET'),
  };
}

interface WhatsAppChannelConfig {
  displayPhoneE164?: string | null;
}

async function getWhatsAppChannelStatus(orgId: string): Promise<WhatsAppChannelStatus> {
  const rows = await db
    .select({ externalId: orgChannels.externalId, config: orgChannels.config })
    .from(orgChannels)
    .where(and(eq(orgChannels.orgId, orgId), eq(orgChannels.channel, 'whatsapp')))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { configured: false, phoneNumberId: null, displayPhoneE164: null, matchesEnvPhoneNumberId: false };
  }

  const config = (row.config as WhatsAppChannelConfig) ?? {};
  const envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null;

  return {
    configured: true,
    phoneNumberId: row.externalId,
    displayPhoneE164: config.displayPhoneE164 ?? null,
    matchesEnvPhoneNumberId: envPhoneNumberId != null && envPhoneNumberId === row.externalId,
  };
}

async function getLastInboundWhatsAppAt(orgId: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .innerJoin(whatsappConversations, eq(whatsappMessages.conversationId, whatsappConversations.id))
    .where(and(eq(whatsappConversations.orgId, orgId), eq(whatsappMessages.direction, 'inbound')))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

async function getAdvisorsWithAvailability(orgId: string): Promise<number> {
  const rows = await db
    .select({ n: countDistinct(agentAvailability.profileId) })
    .from(agentAvailability)
    .where(eq(agentAvailability.orgId, orgId));
  return rows[0]?.n ?? 0;
}

async function getActiveCalendarConnections(orgId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.orgId, orgId), eq(calendarConnections.status, 'active')));
  return rows[0]?.n ?? 0;
}

async function getPublishedListings(orgId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(listings)
    .where(and(eq(listings.orgId, orgId), eq(listings.published, true)));
  return rows[0]?.n ?? 0;
}

/** One read-only snapshot of everything the setup checklist (/dashboard/agent/setup) needs. Never returns secret values. */
export async function getAgentSetupStatus(orgId: string): Promise<SetupStatus> {
  const [config, whatsappChannel, lastInboundWhatsAppAt, advisorsWithAvailability, activeCalendarConnections, publishedListings] =
    await Promise.all([
      getOrCreateAgentConfig(orgId),
      getWhatsAppChannelStatus(orgId),
      getLastInboundWhatsAppAt(orgId),
      getAdvisorsWithAvailability(orgId),
      getActiveCalendarConnections(orgId),
      getPublishedListings(orgId),
    ]);

  return {
    env: getEnvPresence(),
    whatsappChannel,
    lastInboundWhatsAppAt,
    agent: {
      whatsappEnabled: config.channelsEnabled.whatsapp,
      webEnabled: config.channelsEnabled.web,
      voiceEnabled: config.channelsEnabled.voice,
      shadowMode: config.shadowMode,
    },
    advisorsWithAvailability,
    activeCalendarConnections,
    publishedListings,
  };
}
