/**
 * Per-org agent configuration — seeded with defaults on first read rather
 * than by a migration-time insert, so every org (including ones created
 * after this migration) gets one without a backfill script.
 */

import { db } from '@/lib/db';
import { agentConfigs } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export interface AgentConfig {
  id: string;
  orgId: string;
  persona: string;
  tone: 'profesional' | 'cercano' | 'formal';
  rules: string | null;
  prohibited: string | null;
  faq: Array<{ question: string; answer: string }>;
  businessHours: Record<string, unknown>;
  timezone: string;
  qualificationFields: string[];
  followupPolicy: Record<string, unknown>;
  routingMode: 'round_robin' | 'weighted' | 'manual';
  dailyTokenBudget: number;
  widgetAllowedOrigins: string[];
  channelsEnabled: { whatsapp: boolean; web: boolean; voice: boolean };
  shadowMode: boolean;
  maxAgentTurns: number | null;
  /** Phase 7: public catalogue pages (/p/<orgSlug>) are opt-in — see 0009's migration comment for why. */
  publicPagesEnabled: boolean;
}

function toAgentConfig(row: typeof agentConfigs.$inferSelect): AgentConfig {
  return {
    id: row.id,
    orgId: row.orgId,
    persona: row.persona,
    tone: row.tone as AgentConfig['tone'],
    rules: row.rules,
    prohibited: row.prohibited,
    faq: (row.faq as AgentConfig['faq']) ?? [],
    businessHours: (row.businessHours as Record<string, unknown>) ?? {},
    timezone: row.timezone,
    qualificationFields: (row.qualificationFields as string[]) ?? [],
    followupPolicy: (row.followupPolicy as Record<string, unknown>) ?? {},
    routingMode: row.routingMode as AgentConfig['routingMode'],
    dailyTokenBudget: row.dailyTokenBudget,
    widgetAllowedOrigins: (row.widgetAllowedOrigins as string[]) ?? [],
    channelsEnabled: (row.channelsEnabled as AgentConfig['channelsEnabled']) ?? {
      whatsapp: false,
      web: false,
      voice: false,
    },
    shadowMode: row.shadowMode,
    maxAgentTurns: row.maxAgentTurns,
    publicPagesEnabled: row.publicPagesEnabled,
  };
}

/** Get an org's agent config, creating the row with defaults if it doesn't exist yet. */
export async function getOrCreateAgentConfig(orgId: string): Promise<AgentConfig> {
  const existing = await db.select().from(agentConfigs).where(eq(agentConfigs.orgId, orgId)).limit(1);
  if (existing[0]) return toAgentConfig(existing[0]);

  const inserted = await db
    .insert(agentConfigs)
    .values({ orgId })
    .onConflictDoNothing({ target: agentConfigs.orgId })
    .returning();

  if (inserted[0]) return toAgentConfig(inserted[0]);

  // Lost a race with a concurrent first-read — re-fetch the row the other request created.
  const rows = await db.select().from(agentConfigs).where(eq(agentConfigs.orgId, orgId)).limit(1);
  if (!rows[0]) throw new Error('[agent/config] failed to get or create agent_configs row');
  return toAgentConfig(rows[0]);
}

export interface UpdateAgentLiveSettingsPatch {
  whatsappEnabled?: boolean;
  shadowMode?: boolean;
  maxAgentTurns?: number | null;
}

/**
 * Update the "go live" settings from the inbox's LiveSettingsForm. Merges
 * into channels_enabled (never overwrites web/voice) and only touches
 * shadow_mode / max_agent_turns when explicitly provided.
 */
export async function updateAgentLiveSettings(
  orgId: string,
  patch: UpdateAgentLiveSettingsPatch
): Promise<AgentConfig> {
  const current = await getOrCreateAgentConfig(orgId);

  const channelsEnabled = {
    ...current.channelsEnabled,
    ...(patch.whatsappEnabled !== undefined ? { whatsapp: patch.whatsappEnabled } : {}),
  };

  const rows = await db
    .update(agentConfigs)
    .set({
      channelsEnabled,
      ...(patch.shadowMode !== undefined ? { shadowMode: patch.shadowMode } : {}),
      ...(patch.maxAgentTurns !== undefined ? { maxAgentTurns: patch.maxAgentTurns } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(agentConfigs.orgId, orgId))
    .returning();

  if (!rows[0]) throw new Error('[agent/config] updateAgentLiveSettings: org has no agent_configs row');
  return toAgentConfig(rows[0]);
}

/** Phase 7: the /dashboard/agent/widget "Enable public pages" toggle (item B). Org-scoped. */
export async function setPublicPagesEnabled(orgId: string, enabled: boolean): Promise<void> {
  await getOrCreateAgentConfig(orgId); // ensures the row exists before the update below
  await db
    .update(agentConfigs)
    .set({ publicPagesEnabled: enabled, updatedAt: sql`now()` })
    .where(eq(agentConfigs.orgId, orgId));
}
