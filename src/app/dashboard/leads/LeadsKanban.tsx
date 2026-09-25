'use client';

/**
 * Dual-pipeline kanban for /dashboard/leads (item F, blueprint §7). Native
 * HTML5 drag-and-drop (no dnd library — blueprint §0.2), with a `<select>`
 * "Mover a" fallback on every card for a11y/mobile. Optimistic stage moves
 * via useOptimistic; the server action is the source of truth and a failed
 * move reverts on the next router.refresh().
 */

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  assignLead,
  autoAssignLead,
  moveLeadStage,
  setDoNotContact,
} from '@/app/actions/leads-pipeline';
import type { ActionResult } from '@/lib/errors';
import type { Pipeline, StageKind } from '@/lib/leads/types';

export const OTHER_STAGE_KEY = '__other__';

export interface LeadCardData {
  id: string;
  fullName: string;
  stage: string;
  score: number;
  intentTag: string | null;
  assignedProfileId: string | null;
  advisorName: string | null;
  nextFollowupAt: string | null; // ISO
  followupState: string;
  source: string | null;
  sourceChannel: string | null;
  doNotContact: boolean;
  sessionId: string | null;
}

export interface KanbanColumn {
  key: string;
  label: string;
  color: string | null;
  kind: StageKind;
  count: number;
  leads: LeadCardData[];
}

export interface AdvisorOption {
  id: string;
  fullName: string;
}

export interface LeadsKanbanProps {
  pipeline: Pipeline;
  columns: KanbanColumn[];
  advisors: AdvisorOption[];
  selectedAdvisor: string;
  q: string;
}

type OptimisticAction = { type: 'move'; leadId: string; toStage: string };

function moveCardOptimistically(columns: KanbanColumn[], action: OptimisticAction): KanbanColumn[] {
  let moved: LeadCardData | undefined;
  const withoutCard = columns.map((col) => {
    const idx = col.leads.findIndex((l) => l.id === action.leadId);
    if (idx === -1) return col;
    moved = col.leads[idx];
    return { ...col, leads: col.leads.filter((l) => l.id !== action.leadId), count: Math.max(0, col.count - 1) };
  });
  if (!moved) return columns;
  const movedCard = { ...moved, stage: action.toStage };
  return withoutCard.map((col) => (col.key === action.toStage ? { ...col, leads: [movedCard, ...col.leads], count: col.count + 1 } : col));
}

export function LeadsKanban({ pipeline, columns, advisors, selectedAdvisor, q }: LeadsKanbanProps) {
  const t = useTranslations('leadsPipeline');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimisticColumns, applyMove] = useOptimistic(columns, moveCardOptimistically);
  const [error, setError] = useState<string | null>(null);
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(q);

  const stageKeys = useMemo(() => columns.filter((c) => c.key !== OTHER_STAGE_KEY).map((c) => c.key), [columns]);

  function runResult(promise: Promise<ActionResult<unknown>>) {
    startTransition(() => {
      promise.then((result) => {
        if (result.error) setError(result.error.message);
        else {
          setError(null);
          router.refresh();
        }
      });
    });
  }

  function handleMove(leadId: string, toStage: string) {
    if (toStage === OTHER_STAGE_KEY) return;
    startTransition(() => applyMove({ type: 'move', leadId, toStage }));
    runResult(moveLeadStage({ leadId, stage: toStage }));
  }

  function pushQuery(next: { advisor?: string; q?: string }) {
    const params = new URLSearchParams({ pipeline });
    const advisor = next.advisor ?? selectedAdvisor;
    const query = next.q ?? q;
    if (advisor !== 'all') params.set('advisor', advisor);
    if (query) params.set('q', query);
    router.push(`/dashboard/leads?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          {t('allAdvisors')}
          <select
            value={selectedAdvisor}
            onChange={(e) => pushQuery({ advisor: e.target.value })}
            className="px-2 py-1 text-sm border border-slate-200 rounded-md"
          >
            <option value="all">{t('allAdvisors')}</option>
            <option value="unassigned">{t('unassigned')}</option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>{a.fullName}</option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => { e.preventDefault(); pushQuery({ q: searchInput }); }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            maxLength={80}
            placeholder={t('title')}
            className="px-2 py-1 text-sm border border-slate-200 rounded-md"
          />
          <Button type="submit" size="sm" variant="secondary">{t('title')}</Button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {optimisticColumns.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => { if (dragLeadId && col.key !== OTHER_STAGE_KEY) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const leadId = e.dataTransfer.getData('text/plain') || dragLeadId;
              if (leadId) handleMove(leadId, col.key);
              setDragLeadId(null);
            }}
            className="bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-2 min-h-[10rem]"
          >
            <div className="flex items-center justify-between gap-1 px-1">
              <span
                className="text-xs font-semibold uppercase tracking-wide truncate"
                style={col.color ? { color: col.color } : undefined}
              >
                {col.label}
              </span>
              <Badge variant="default">{col.count}</Badge>
            </div>

            <div className="space-y-2">
              {col.leads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  stageKeys={stageKeys}
                  advisors={advisors}
                  onDragStart={(e) => { setDragLeadId(lead.id); e.dataTransfer.setData('text/plain', lead.id); }}
                  onMove={(toStage) => handleMove(lead.id, toStage)}
                  onAssign={(profileId) => runResult(assignLead({ leadId: lead.id, profileId }))}
                  onAutoAssign={() => runResult(autoAssignLead({ leadId: lead.id }))}
                  onToggleDoNotContact={() => runResult(setDoNotContact({ leadId: lead.id, value: !lead.doNotContact }))}
                />
              ))}
              {col.count > col.leads.length && (
                <p className="text-[11px] text-slate-400 px-1">+{col.count - col.leads.length} {t('more')}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  stageKeys,
  advisors,
  onDragStart,
  onMove,
  onAssign,
  onAutoAssign,
  onToggleDoNotContact,
}: {
  lead: LeadCardData;
  stageKeys: string[];
  advisors: AdvisorOption[];
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onMove: (toStage: string) => void;
  onAssign: (profileId: string | null) => void;
  onAutoAssign: () => void;
  onToggleDoNotContact: () => void;
}) {
  const t = useTranslations('leadsPipeline');
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="border border-slate-200 rounded-lg bg-white p-2 space-y-1.5 shadow-sm cursor-move"
      data-testid={`lead-card-${lead.id}`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm font-medium text-slate-900 truncate">{lead.fullName}</p>
        {lead.intentTag && <Badge variant="info">{lead.intentTag}</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
        <span>{t('assign')}: {lead.advisorName ?? t('unassigned')}</span>
        {lead.source && <span>· {lead.source}</span>}
      </div>

      {lead.nextFollowupAt && (
        <p className="text-[11px] text-slate-400">
          {t('nextFollowup')}: {new Date(lead.nextFollowupAt).toLocaleString('es-PE')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {lead.followupState === 'active' && <Badge variant="success">{t('followupActive')}</Badge>}
        {lead.followupState === 'stopped' && <Badge variant="default">{t('followupStopped')}</Badge>}
        {lead.doNotContact && <Badge variant="danger">{t('doNotContact')}</Badge>}
        {lead.sessionId && (
          <Link href={`/dashboard/agent/inbox/${lead.sessionId}`} className="text-[11px] text-brand-600 hover:underline">
            →
          </Link>
        )}
      </div>

      <select
        value={lead.stage}
        onChange={(e) => onMove(e.target.value)}
        aria-label={t('moveTo')}
        className="w-full text-[11px] px-1.5 py-1 border border-slate-200 rounded-md"
      >
        {stageKeys.map((key) => (
          <option key={key} value={key}>{key === lead.stage ? `→ ${key}` : key}</option>
        ))}
      </select>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50 w-full"
        >
          {t('assign')}
        </button>
        {menuOpen && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg p-1 space-y-1">
            <button
              type="button"
              onClick={() => { onAutoAssign(); setMenuOpen(false); }}
              className="w-full text-left text-[11px] px-1.5 py-1 rounded hover:bg-slate-50"
            >
              {t('autoAssign')}
            </button>
            <select
              defaultValue=""
              onChange={(e) => { onAssign(e.target.value || null); setMenuOpen(false); }}
              className="w-full text-[11px] px-1.5 py-1 border border-slate-200 rounded-md"
            >
              <option value="">{t('unassigned')}</option>
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>{a.fullName}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { onToggleDoNotContact(); setMenuOpen(false); }}
              className="w-full text-left text-[11px] px-1.5 py-1 rounded hover:bg-slate-50"
            >
              {t('doNotContact')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
