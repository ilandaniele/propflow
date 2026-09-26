'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Tabs } from '@/components/ui/Tabs';
import type { AgentConfig } from '@/lib/agent/config';
import type { FollowupPolicy } from '@/lib/leads/types';
import type { VoiceChannel } from '@/lib/agent/voice/types';
import { IdentityTab } from './_components/IdentityTab';
import { KnowledgeTab } from './_components/KnowledgeTab';
import { HoursTab } from './_components/HoursTab';
import { FollowupsTab } from './_components/FollowupsTab';
import { RoutingTab } from './_components/RoutingTab';
import { ChannelsTab } from './_components/ChannelsTab';
import { VoiceTab } from './_components/VoiceTab';

type SettingsConfig = Pick<
  AgentConfig,
  | 'persona'
  | 'tone'
  | 'timezone'
  | 'rules'
  | 'prohibited'
  | 'faq'
  | 'qualificationFields'
  | 'businessHours'
  | 'routingMode'
  | 'dailyTokenBudget'
  | 'shadowMode'
  | 'maxAgentTurns'
  | 'maxActiveVisitsPerPhone'
  | 'maxListingPhotos'
  | 'channelsEnabled'
  | 'voice'
>;

export interface SettingsClientProps {
  config: SettingsConfig;
  followupPolicy: FollowupPolicy;
  voiceChannel: VoiceChannel | null;
  monthlyUsage: { usedMinutes: number; inFlightCalls: number };
  dncItems: Array<{ phoneE164: string; source: 'staff' | 'caller_request'; reason: string | null; createdAt: Date | string }>;
  dncTotal: number;
  dncPage: number;
  dncQuery: string;
}

const TAB_IDS = ['identity', 'knowledge', 'hours', 'followups', 'routing', 'channels', 'voice'] as const;

/** Reads the URL hash once (for the DNC list's search/pagination, which round-trips through the server) so the Voz tab stays selected after that reload. */
function initialTab(): (typeof TAB_IDS)[number] {
  if (typeof window === 'undefined') return 'identity';
  const hash = window.location.hash.replace('#', '');
  return (TAB_IDS as readonly string[]).includes(hash) ? (hash as (typeof TAB_IDS)[number]) : 'identity';
}

export function SettingsClient({ config, followupPolicy, voiceChannel, monthlyUsage, dncItems, dncTotal, dncPage, dncQuery }: SettingsClientProps) {
  const t = useTranslations('agentSettings');
  const [defaultTab] = useState(initialTab);

  return (
    <>
      <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
      <Tabs
        defaultTab={defaultTab}
        tabs={[
          { id: 'identity', label: t('identity'), content: <IdentityTab persona={config.persona} tone={config.tone} timezone={config.timezone} /> },
          {
            id: 'knowledge',
            label: t('knowledge'),
            content: (
              <KnowledgeTab
                rules={config.rules}
                prohibited={config.prohibited}
                faq={config.faq}
                qualificationFields={config.qualificationFields}
              />
            ),
          },
          { id: 'hours', label: t('hours'), content: <HoursTab businessHours={config.businessHours} /> },
          { id: 'followups', label: t('followups'), content: <FollowupsTab policy={followupPolicy} /> },
          { id: 'routing', label: t('routing'), content: <RoutingTab routingMode={config.routingMode} /> },
          {
            id: 'channels',
            label: t('channels'),
            content: (
              <ChannelsTab
                whatsappEnabled={config.channelsEnabled.whatsapp}
                voiceEnabled={config.channelsEnabled.voice}
                dailyTokenBudget={config.dailyTokenBudget}
                shadowMode={config.shadowMode}
                maxAgentTurns={config.maxAgentTurns}
                maxActiveVisitsPerPhone={config.maxActiveVisitsPerPhone}
                maxListingPhotos={config.maxListingPhotos}
                hasVoiceNumber={voiceChannel != null}
              />
            ),
          },
          {
            id: 'voice',
            label: t('voice'),
            content: (
              <VoiceTab
                voice={config.voice}
                voiceChannel={voiceChannel}
                monthlyUsage={monthlyUsage}
                dncItems={dncItems}
                dncTotal={dncTotal}
                dncPage={dncPage}
                dncQuery={dncQuery}
              />
            ),
          },
        ]}
      />
    </>
  );
}
