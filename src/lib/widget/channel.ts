/**
 * The web channel: org_channels(channel='web') routes a public key to an
 * org; agent_configs holds the on/off switch (channels_enabled.web) and the
 * allowed-origins list (widget_allowed_origins — both pre-existing columns,
 * Phase 7 decision 4). org_channels.config holds the per-channel extras
 * (caps, greeting, accent colour).
 */

import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { organizations, orgChannels, agentConfigs } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';

export const PUBLIC_KEY_RE = /^pk_[A-Za-z0-9]{24}$/;

/** E.164: leading '+', no leading 0, 7-15 digits total after the '+'. */
export const E164_RE = /^\+[1-9]\d{6,14}$/;

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEY_LEN = 24;

const DEFAULT_DAILY_MESSAGE_CAP = 300;
const DEFAULT_DAILY_SESSION_CAP = 150;
const ACCENT_COLOR_RE = /^#[0-9a-f]{6}$/i;

export interface WebChannel {
  orgId: string;
  channelId: string;
  publicKey: string;
  orgName: string;
  enabled: boolean;
  allowedOrigins: string[];
  dailyMessageCap: number;
  dailySessionCap: number;
  greeting: string | null;
  accentColor: string | null;
  whatsappDisplayPhone: string | null;
}

interface WebChannelConfig {
  dailyMessageCap?: number;
  dailySessionCap?: number;
  greeting?: string | null;
  accentColor?: string | null;
}

export function generatePublicKey(): string {
  const bytes = randomBytes(KEY_LEN);
  let out = '';
  for (let i = 0; i < KEY_LEN; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return `pk_${out}`;
}

async function getWebChannelRow(orgId: string) {
  const rows = await db
    .select()
    .from(orgChannels)
    .where(and(eq(orgChannels.orgId, orgId), eq(orgChannels.channel, 'web')))
    .limit(1);
  return rows[0] ?? null;
}

async function buildWebChannel(
  row: typeof orgChannels.$inferSelect,
): Promise<WebChannel> {
  const [orgRow] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, row.orgId)).limit(1);
  const config = await getOrCreateAgentConfig(row.orgId);
  const channelConfig = (row.config as WebChannelConfig) ?? {};
  const whatsappDisplayPhone = await getWhatsAppDisplayPhone(row.orgId);

  return {
    orgId: row.orgId,
    channelId: row.id,
    publicKey: row.externalId,
    orgName: orgRow?.name ?? '',
    enabled: config.channelsEnabled.web && config.widgetAllowedOrigins.length > 0,
    allowedOrigins: config.widgetAllowedOrigins,
    dailyMessageCap: channelConfig.dailyMessageCap ?? DEFAULT_DAILY_MESSAGE_CAP,
    dailySessionCap: channelConfig.dailySessionCap ?? DEFAULT_DAILY_SESSION_CAP,
    greeting: channelConfig.greeting ?? null,
    accentColor: channelConfig.accentColor ?? null,
    whatsappDisplayPhone,
  };
}

/** Null when the key is malformed, unknown, or the org has no web channel row. One indexed query on the happy path (pitfall §6: resolveWebChannel runs on every request). */
export async function resolveWebChannel(publicKey: string): Promise<WebChannel | null> {
  if (!PUBLIC_KEY_RE.test(publicKey)) return null;

  const rows = await db
    .select()
    .from(orgChannels)
    .where(and(eq(orgChannels.channel, 'web'), eq(orgChannels.externalId, publicKey)))
    .limit(1);
  if (!rows[0]) return null;

  return buildWebChannel(rows[0]);
}

export async function getOrgWebChannel(orgId: string): Promise<WebChannel | null> {
  const row = await getWebChannelRow(orgId);
  return row ? buildWebChannel(row) : null;
}

export interface UpsertWebChannelPatch {
  enabled?: boolean;
  allowedOrigins?: string[];
  dailyMessageCap?: number;
  dailySessionCap?: number;
  greeting?: string | null;
  accentColor?: string | null;
}

/** Creates the org's web channel (with a fresh public key) if it doesn't have one yet. Never touches whatsapp/voice's channels_enabled entries. */
export async function upsertWebChannel(orgId: string, patch: UpsertWebChannelPatch): Promise<WebChannel> {
  if (patch.accentColor != null && !ACCENT_COLOR_RE.test(patch.accentColor)) {
    throw new Error('[widget/channel] accentColor must match #rrggbb');
  }

  const existing = await getWebChannelRow(orgId);
  const currentConfig = (existing?.config as WebChannelConfig) ?? {};
  const nextConfig: WebChannelConfig = {
    ...currentConfig,
    ...(patch.dailyMessageCap !== undefined ? { dailyMessageCap: patch.dailyMessageCap } : {}),
    ...(patch.dailySessionCap !== undefined ? { dailySessionCap: patch.dailySessionCap } : {}),
    ...(patch.greeting !== undefined ? { greeting: patch.greeting } : {}),
    ...(patch.accentColor !== undefined ? { accentColor: patch.accentColor } : {}),
  };

  if (existing) {
    await db
      .update(orgChannels)
      .set({ config: nextConfig, updatedAt: new Date() })
      .where(eq(orgChannels.id, existing.id));
  } else {
    await db.insert(orgChannels).values({
      orgId,
      channel: 'web',
      externalId: generatePublicKey(),
      config: nextConfig,
    });
  }

  const config = await getOrCreateAgentConfig(orgId);
  const channelsEnabled = {
    ...config.channelsEnabled,
    ...(patch.enabled !== undefined ? { web: patch.enabled } : {}),
  };
  await db
    .update(agentConfigs)
    .set({
      channelsEnabled,
      ...(patch.allowedOrigins !== undefined ? { widgetAllowedOrigins: patch.allowedOrigins } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(agentConfigs.orgId, orgId));

  const row = await getWebChannelRow(orgId);
  if (!row) throw new Error('[widget/channel] upsertWebChannel: failed to read back the web channel row');
  return buildWebChannel(row);
}

export async function rotateWebPublicKey(orgId: string): Promise<string> {
  const existing = await getWebChannelRow(orgId);
  if (!existing) {
    const created = await upsertWebChannel(orgId, {});
    return created.publicKey;
  }

  const newKey = generatePublicKey();
  await db
    .update(orgChannels)
    .set({ externalId: newKey, updatedAt: new Date() })
    .where(eq(orgChannels.id, existing.id));
  return newKey;
}

interface WhatsAppChannelConfig {
  displayPhoneE164?: string | null;
}

/** org_channels(channel='whatsapp').config.displayPhoneE164 — required for wa.me links. Null when unset or the org has no whatsapp channel row yet. */
export async function getWhatsAppDisplayPhone(orgId: string): Promise<string | null> {
  const rows = await db
    .select({ config: orgChannels.config })
    .from(orgChannels)
    .where(and(eq(orgChannels.orgId, orgId), eq(orgChannels.channel, 'whatsapp')))
    .limit(1);
  const config = (rows[0]?.config as WhatsAppChannelConfig) ?? {};
  return config.displayPhoneE164 ?? null;
}

/**
 * OVERRIDE (A, phase7-blueprint.md "owner change"): lets an admin set the
 * WhatsApp display number from /dashboard/agent/widget (item B) instead of
 * by hand with SQL. Org-scoped (only ever touches this org's whatsapp row)
 * and validates E.164. Returns false when the org has no whatsapp
 * org_channels row yet — item B surfaces that as a form error, since there's
 * nothing to attach the number to (the whatsapp row is provisioned
 * separately, per decision 4).
 */
export async function setWhatsAppDisplayPhone(orgId: string, phoneE164: string): Promise<boolean> {
  if (!E164_RE.test(phoneE164)) {
    throw new Error('[widget/channel] setWhatsAppDisplayPhone: phone must be E.164 (e.g. +51987654321)');
  }

  const rows = await db
    .select({ id: orgChannels.id, config: orgChannels.config })
    .from(orgChannels)
    .where(and(eq(orgChannels.orgId, orgId), eq(orgChannels.channel, 'whatsapp')))
    .limit(1);
  const row = rows[0];
  if (!row) return false;

  const nextConfig = { ...((row.config as WhatsAppChannelConfig) ?? {}), displayPhoneE164: phoneE164 };
  await db.update(orgChannels).set({ config: nextConfig, updatedAt: new Date() }).where(eq(orgChannels.id, row.id));
  return true;
}
