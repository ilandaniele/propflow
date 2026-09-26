import { getTranslations } from 'next-intl/server';
import type { AgentAttribution, AgentLanguage } from '@/lib/agent/types';

export interface LeadPanelProps {
  fullName: string | null;
  phone: string | null;
  stage: string | null;
  score: number | null;
  intentTag: string | null;
  zones: string[];
  budgetMin: string | null;
  budgetMax: string | null;
  currency: string | null;
  attribution: AgentAttribution | null;
  language: AgentLanguage | null;
}

function formatCode(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : '—';
}

function formatBudget(min: string | null, max: string | null, currency: string | null): string {
  if (!min && !max) return '—';
  const cur = currency ?? '';
  if (min && max) return `${cur} ${min} – ${max}`.trim();
  return `${cur} ${min ?? max}`.trim();
}

/** Right-column panel: name, phone, stage, score/intent, zones, budget, attribution and language. */
export async function LeadPanel({
  fullName, phone, stage, score, intentTag, zones, budgetMin, budgetMax, currency, attribution, language,
}: LeadPanelProps) {
  const t = await getTranslations('agentInbox');

  if (!fullName && !phone) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-sm text-slate-400">{t('leadPanel.noLead')}</p>
      </div>
    );
  }

  const attributionValue = attribution
    ? attribution.type === 'ctwa'
      ? (attribution.headline ?? attribution.sourceId ?? '—')
      : (attribution.refCode ?? '—')
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-900">{fullName ?? t('leadPanel.title')}</p>

      <dl className="space-y-2 text-sm">
        {phone && (
          <div>
            <dt className="text-xs text-slate-400">{t('leadPanel.phone')}</dt>
            <dd className="text-slate-900">{phone}</dd>
          </div>
        )}
        {stage && (
          <div>
            <dt className="text-xs text-slate-400">{t('leadPanel.stage')}</dt>
            <dd className="text-slate-900">{formatCode(stage)}</dd>
          </div>
        )}
        {(score != null || intentTag) && (
          <div>
            <dt className="text-xs text-slate-400">{t('leadPanel.score')} / {t('leadPanel.intent')}</dt>
            <dd className="text-slate-900">{score ?? '—'} · {formatCode(intentTag)}</dd>
          </div>
        )}
        {zones.length > 0 && (
          <div>
            <dt className="text-xs text-slate-400">{t('leadPanel.zones')}</dt>
            <dd className="text-slate-900">{zones.join(', ')}</dd>
          </div>
        )}
        {(budgetMin || budgetMax) && (
          <div>
            <dt className="text-xs text-slate-400">{t('leadPanel.budget')}</dt>
            <dd className="text-slate-900">{formatBudget(budgetMin, budgetMax, currency)}</dd>
          </div>
        )}
        {attributionValue && (
          <div>
            <dt className="text-xs text-slate-400">{t('leadPanel.attribution')}</dt>
            <dd className="text-slate-900">{attributionValue}</dd>
          </div>
        )}
        {language && (
          <div>
            <dt className="text-xs text-slate-400">{t('leadPanel.language')}</dt>
            <dd className="text-slate-900">{language.toUpperCase()}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
