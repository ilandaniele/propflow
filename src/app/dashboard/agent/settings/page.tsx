import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { parseFollowupPolicy } from '@/lib/leads/types';
import { getOrgVoiceChannel } from '@/lib/agent/voice/calls';
import { getMonthlyVoiceUsage } from '@/lib/agent/voice/usage';
import { listDoNotCall } from '@/lib/agent/voice/dnc';
import { SettingsClient } from './SettingsClient';

export const metadata: Metadata = { title: 'Configuración del agente' };

interface AgentSettingsPageProps {
  searchParams: Promise<{ dncQ?: string; dncPage?: string }>;
}

/**
 * Server shell for /dashboard/agent/settings (item D): loads everything the
 * tabs need up front, then hands typed props to the client tab shell. Writes
 * go through src/app/actions/agent-settings.ts's per-tab actions, which all
 * re-validate against config-schema.ts and re-derive orgId from the session.
 */
export default async function AgentSettingsPage({ searchParams }: AgentSettingsPageProps) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const sp = await searchParams;
  const dncPage = Math.max(1, Number(sp.dncPage) || 1);

  const [config, voiceChannel, dnc] = await Promise.all([
    getOrCreateAgentConfig(ctx.orgId),
    getOrgVoiceChannel(ctx.orgId),
    listDoNotCall(ctx.orgId, { q: sp.dncQ, page: dncPage }),
  ]);

  const followupPolicy = parseFollowupPolicy(config.followupPolicy);
  const monthlyUsage = await getMonthlyVoiceUsage(ctx.orgId, config.timezone);

  return (
    <div className="max-w-3xl space-y-4">
      <SettingsClient
        config={{
          persona: config.persona,
          tone: config.tone,
          timezone: config.timezone,
          rules: config.rules,
          prohibited: config.prohibited,
          faq: config.faq,
          qualificationFields: config.qualificationFields,
          businessHours: config.businessHours,
          routingMode: config.routingMode,
          dailyTokenBudget: config.dailyTokenBudget,
          shadowMode: config.shadowMode,
          maxAgentTurns: config.maxAgentTurns,
          maxActiveVisitsPerPhone: config.maxActiveVisitsPerPhone,
          maxListingPhotos: config.maxListingPhotos,
          channelsEnabled: config.channelsEnabled,
          voice: config.voice,
        }}
        followupPolicy={followupPolicy}
        voiceChannel={voiceChannel}
        monthlyUsage={monthlyUsage}
        dncItems={dnc.items}
        dncTotal={dnc.total}
        dncPage={dncPage}
        dncQuery={sp.dncQ ?? ''}
      />
    </div>
  );
}
