/**
 * Tenant profile header — avatar, name, unit, balance status pill, reliability scores.
 * Server Component (no 'use client').
 */

import { getTranslations } from 'next-intl/server';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import type { ReliabilityScores } from '@/lib/tenants/reliability';

interface ProfileHeaderProps {
  tenant: {
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    photo_url?: string | null;
    profile_id?: string | null;
    reliability_scores?: ReliabilityScores | Record<string, unknown> | null;
  };
  unit?: {
    label: string;
    properties?: { name: string } | null;
  } | null;
  statement?: {
    balance: number;
    is_overdue: boolean;
  } | null;
  avatarSignedUrl?: string | null;
  orgId: string;
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  const color = score >= 90 ? 'text-green-700 bg-green-50' :
                score >= 70 ? 'text-amber-700 bg-amber-50' :
                score >= 50 ? 'text-orange-700 bg-orange-50' :
                'text-red-700 bg-red-50';
  return (
    <div className="text-center">
      <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{score}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export async function ProfileHeader({ tenant, unit, statement, avatarSignedUrl }: ProfileHeaderProps) {
  const t = await getTranslations('profileHeader');
  const scores = tenant.reliability_scores as ReliabilityScores | null;
  const isOverdue = statement?.is_overdue ?? false;
  const balance = statement?.balance ?? 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-start gap-4 flex-wrap">
        {/* Avatar */}
        <div className="shrink-0">
          {avatarSignedUrl ? (
            <Avatar name={tenant.full_name} size="lg" src={avatarSignedUrl} />
          ) : (
            <Avatar name={tenant.full_name} size="lg" />
          )}
        </div>

        {/* Name + unit + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{tenant.full_name}</h1>
            {/* Balance status */}
            {isOverdue ? (
              <Badge variant="danger">{t('overdue')}</Badge>
            ) : balance > 0 ? (
              <Badge variant="success">{t('balanceOk')}</Badge>
            ) : balance < 0 ? (
              <Badge variant="warning">{t('balanceDue')}</Badge>
            ) : null}
            {/* Portal access */}
            {tenant.profile_id ? (
              <Badge variant="info">{t('portalActive')}</Badge>
            ) : (
              <Badge variant="default">{t('noPortal')}</Badge>
            )}
          </div>

          <p className="text-sm text-slate-500 mt-1">
            {unit ? `${unit.properties?.name ?? ''} — ${unit.label}` : t('noUnit')}
          </p>
          <div className="flex gap-4 mt-1 text-sm text-slate-500">
            {tenant.email && <span>{tenant.email}</span>}
            {tenant.phone && <span>{tenant.phone}</span>}
          </div>
        </div>

        {/* Reliability scores */}
        {scores && typeof scores.on_time === 'number' && (
          <div className="flex gap-3 shrink-0">
            <ScoreBadge label={t('onTime')} score={scores.on_time} />
            <ScoreBadge label={t('disputes')} score={scores.dispute} />
            <ScoreBadge label={t('response')} score={scores.response} />
          </div>
        )}
      </div>
    </div>
  );
}
