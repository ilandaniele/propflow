'use client';

/**
 * Routing + follow-up policy settings for /dashboard/leads (item F,
 * blueprint §7): routing mode, the members table (weight/pipeline/active/
 * cap) and the two follow-up toggles. Writes go through
 * src/app/actions/lead-routing.ts.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  removeRoutingMemberAction,
  saveFollowupPolicy,
  saveRoutingMode,
  upsertRoutingMemberAction,
} from '@/app/actions/lead-routing';
import type { ActionResult } from '@/lib/errors';
import type { Pipeline, RoutingMember, RoutingMode } from '@/lib/leads/types';

export interface LeadSettingsCardProps {
  routingMode: RoutingMode;
  members: Array<RoutingMember & { fullName: string | null }>;
  advisors: Array<{ id: string; fullName: string }>;
  followupsEnabled: boolean;
  listingAlertsEnabled: boolean;
}

type MemberPipeline = Pipeline | 'both';

export function LeadSettingsCard({ routingMode, members, advisors, followupsEnabled, listingAlertsEnabled }: LeadSettingsCardProps) {
  const t = useTranslations('leadsPipeline');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RoutingMode>(routingMode);
  const [followups, setFollowups] = useState(followupsEnabled);
  const [listingAlerts, setListingAlerts] = useState(listingAlertsEnabled);
  const [newMemberId, setNewMemberId] = useState('');

  function handleResult(pending: Promise<ActionResult<unknown>>) {
    pending.then((result) => {
      if (result.error) setError(result.error.message);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  const memberProfileIds = new Set(members.map((m) => m.profileId));
  const availableAdvisors = advisors.filter((a) => !memberProfileIds.has(a.id));

  return (
    <Card padding="md">
      <h2 className="text-base font-medium text-slate-800 mb-3">{t('routing')}</h2>
      {error && <p className="text-sm text-red-600 mb-2" role="alert">{error}</p>}

      <label className="flex items-center gap-2 text-sm text-slate-700 mb-3">
        {t('routingMode')}
        <select
          value={mode}
          onChange={(e) => {
            const value = e.target.value as RoutingMode;
            setMode(value);
            handleResult(saveRoutingMode({ mode: value }));
          }}
          className="px-2 py-1 text-sm border border-slate-200 rounded-md"
        >
          <option value="round_robin">{t('rrLabel')}</option>
          <option value="weighted">{t('weightedLabel')}</option>
          <option value="manual">{t('manualLabel')}</option>
        </select>
      </label>

      <div className="space-y-2">
        {members.map((m) => (
          <MemberRow
            key={m.profileId}
            member={m}
            onSave={(patch) => handleResult(upsertRoutingMemberAction({
              profileId: m.profileId,
              pipeline: patch.pipeline ?? m.pipeline,
              weight: patch.weight ?? m.weight,
              active: patch.active ?? m.active,
              maxOpenLeads: patch.maxOpenLeads !== undefined ? patch.maxOpenLeads : m.maxOpenLeads,
            }))}
            onRemove={() => handleResult(removeRoutingMemberAction({ profileId: m.profileId }))}
          />
        ))}
      </div>

      {availableAdvisors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
          <select
            value={newMemberId}
            onChange={(e) => setNewMemberId(e.target.value)}
            className="text-sm px-2 py-1 border border-slate-200 rounded-md"
          >
            <option value="">{t('allAdvisors')}</option>
            {availableAdvisors.map((a) => (
              <option key={a.id} value={a.id}>{a.fullName}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!newMemberId}
            onClick={() => {
              handleResult(upsertRoutingMemberAction({ profileId: newMemberId, pipeline: 'both', weight: 1, active: true, maxOpenLeads: null }));
              setNewMemberId('');
            }}
          >
            Crear
          </Button>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
        <h3 className="text-sm font-medium text-slate-800">{t('followups')}</h3>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={followups}
            onChange={(e) => {
              setFollowups(e.target.checked);
              handleResult(saveFollowupPolicy({ enabled: e.target.checked, listingAlertsEnabled: listingAlerts }));
            }}
            className="rounded border-slate-300"
          />
          {t('followupsEnabled')}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={listingAlerts}
            onChange={(e) => {
              setListingAlerts(e.target.checked);
              handleResult(saveFollowupPolicy({ enabled: followups, listingAlertsEnabled: e.target.checked }));
            }}
            className="rounded border-slate-300"
          />
          {t('listingAlerts')}
        </label>
      </div>
    </Card>
  );
}

function MemberRow({
  member,
  onSave,
  onRemove,
}: {
  member: RoutingMember & { fullName: string | null };
  onSave: (patch: Partial<{ pipeline: MemberPipeline; weight: number; active: boolean; maxOpenLeads: number | null }>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('leadsPipeline');

  return (
    <div className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-md p-2 text-sm">
      <span className="truncate min-w-[6rem]">{member.fullName ?? member.profileId}</span>

      <select
        value={member.pipeline}
        onChange={(e) => onSave({ pipeline: e.target.value as MemberPipeline })}
        className="text-xs px-1 py-0.5 border border-slate-200 rounded-md"
      >
        <option value="both">both</option>
        <option value="demand">demand</option>
        <option value="supply">supply</option>
      </select>

      <label className="flex items-center gap-1 text-xs text-slate-600">
        {t('weight')}
        <input
          type="number"
          min={1}
          max={100}
          defaultValue={member.weight}
          onBlur={(e) => onSave({ weight: Number(e.target.value) || 1 })}
          className="w-14 text-xs px-1 py-0.5 border border-slate-200 rounded-md"
        />
      </label>

      <label className="flex items-center gap-1 text-xs text-slate-600">
        {t('maxOpen')}
        <input
          type="number"
          min={1}
          defaultValue={member.maxOpenLeads ?? ''}
          onBlur={(e) => onSave({ maxOpenLeads: e.target.value ? Number(e.target.value) : null })}
          className="w-16 text-xs px-1 py-0.5 border border-slate-200 rounded-md"
        />
      </label>

      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={member.active}
          onChange={(e) => onSave({ active: e.target.checked })}
          className="rounded border-slate-300"
        />
        Activo
      </label>

      <button type="button" onClick={onRemove} className="ml-auto text-xs px-1.5 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50">
        Eliminar
      </button>
    </div>
  );
}
