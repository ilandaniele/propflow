'use client';

/**
 * Stage-list settings for /dashboard/leads (item F, blueprint §7): add,
 * rename, recolor, reorder (up/down) and archive stages. Deleting a stage
 * asks for a target stage to move its leads to. System stages (won/lost)
 * cannot be archived or deleted — the actions enforce that; this UI just
 * surfaces the resulting FORBIDDEN/VALIDATION_ERROR.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  createStage,
  deleteStage,
  reorderStages,
  updateStage,
} from '@/app/actions/leads-pipeline';
import type { ActionResult } from '@/lib/errors';
import type { Pipeline, PipelineStage, StageKind } from '@/lib/leads/types';

export interface StageSettingsDialogLauncherProps {
  pipeline: Pipeline;
  stages: PipelineStage[];
}

export function StageSettingsDialogLauncher({ pipeline, stages }: StageSettingsDialogLauncherProps) {
  const t = useTranslations('leadsPipeline');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<StageKind>('open');
  const [deleteTarget, setDeleteTarget] = useState<Record<string, string>>({});

  function handleResult(pending: Promise<ActionResult<unknown>>) {
    pending.then((result) => {
      if (result.error) setError(result.error.message);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  async function handleAdd() {
    if (!newLabel.trim()) return;
    handleResult(createStage({ pipeline, label: newLabel.trim(), kind: newKind }));
    setNewLabel('');
  }

  function handleMove(id: string, direction: -1 | 1) {
    const idx = stages.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= stages.length) return;
    const orderedIds = stages.map((s) => s.id);
    [orderedIds[idx], orderedIds[swapWith]] = [orderedIds[swapWith], orderedIds[idx]];
    handleResult(reorderStages({ pipeline, orderedIds }));
  }

  return (
    <Card padding="md">
      <h2 className="text-base font-medium text-slate-800 mb-3">{t('stages')}</h2>
      {error && <p className="text-sm text-red-600 mb-2" role="alert">{error}</p>}

      <div className="space-y-2">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-md p-2 text-sm">
            <span className="flex items-center gap-1 min-w-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: stage.color ?? '#cbd5e1' }}
              />
              <span className="truncate">{stage.label}</span>
            </span>
            <span className="text-xs text-slate-400">{stage.key}</span>

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => handleMove(stage.id, -1)} disabled={idx === 0} className="text-xs px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-30">↑</button>
              <button type="button" onClick={() => handleMove(stage.id, 1)} disabled={idx === stages.length - 1} className="text-xs px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-30">↓</button>
              <input
                type="color"
                value={stage.color ?? '#cbd5e1'}
                onChange={(e) => handleResult(updateStage({ id: stage.id, color: e.target.value }))}
                className="w-6 h-6 p-0 border border-slate-200 rounded"
              />
              <button
                type="button"
                onClick={() => handleResult(updateStage({ id: stage.id, archived: true }))}
                className="text-xs px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50"
              >
                {t('archive')}
              </button>
              {!stage.isSystem && (
                <>
                  <select
                    value={deleteTarget[stage.id] ?? ''}
                    onChange={(e) => setDeleteTarget((prev) => ({ ...prev, [stage.id]: e.target.value }))}
                    className="text-xs px-1 py-0.5 border border-slate-200 rounded-md"
                  >
                    <option value="">{t('moveLeadsTo')}</option>
                    {stages.filter((s) => s.id !== stage.id).map((s) => (
                      <option key={s.id} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!deleteTarget[stage.id]}
                    onClick={() => handleResult(deleteStage({ id: stage.id, moveLeadsTo: deleteTarget[stage.id] }))}
                    className="text-xs px-1.5 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-30"
                  >
                    {t('deleteStage')}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={t('addStage')}
          maxLength={60}
          className="text-sm px-2 py-1 border border-slate-200 rounded-md flex-1 min-w-[8rem]"
        />
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as StageKind)}
          className="text-sm px-2 py-1 border border-slate-200 rounded-md"
        >
          <option value="open">open</option>
          <option value="won">won</option>
          <option value="lost">lost</option>
        </select>
        <Button size="sm" variant="secondary" onClick={handleAdd}>Crear</Button>
      </div>
    </Card>
  );
}
