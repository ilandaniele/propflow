/**
 * Per-org agent configuration — seeded with defaults on first read rather
 * than by a migration-time insert, so every org (including ones created
 * after this migration) gets one without a backfill script.
 */

import { db } from '@/lib/db';
import { agentConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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
