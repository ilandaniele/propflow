'use client';

/**
 * LeakDetectorRunner — client component that wires the Hidden Leak Detector
 * agent card to the runHiddenLeakDetector Server Action (AC14).
 *
 * Renders:
 *  - AgentCard with status='available'
 *  - On Run click → calls the server action → shows results table
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AgentCard } from './AgentCard';
import type { LeakFinding } from '@/lib/finance/leak-detector';
import type { ActionResult } from '@/lib/errors';

interface LeakDetectorRunnerProps {
  runAction: () => Promise<ActionResult<LeakFinding[]>>;
}

export function LeakDetectorRunner({ runAction }: LeakDetectorRunnerProps) {
  const t = useTranslations('executiveBrief');
  const [isPending, startTransition] = useTransition();
  const [findings, setFindings] = useState<LeakFinding[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleRun() {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await runAction();
      if (result.error) {
        setErrorMsg(t('leakResults.error'));
      } else {
        setFindings(result.data ?? []);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <AgentCard
        id="hidden-leak-detector"
        title={t('agents.leakDetector.title')}
        description={t('agents.leakDetector.description')}
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        }
        status="available"
        onRun={handleRun}
        isRunning={isPending}
      />

      {/* Error state */}
      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
        >
          {errorMsg}
        </div>
      )}

      {/* Results table */}
      {findings !== null && (
        <div
          data-testid="leak-findings"
          className="bg-white rounded-xl border border-slate-200 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900">
              {t('leakResults.title')}
            </h4>
            <span className="text-xs text-slate-500">
              {findings.length === 0 ? t('leakResults.noLeaks') : `${findings.length} leak(s)`}
            </span>
          </div>

          {findings.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">
              {t('leakResults.noLeaks')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('leakResults.unit')}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('leakResults.billed')}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('leakResults.collected')}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('leakResults.gap')}
                    </th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('leakResults.severity')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {findings.map((f) => (
                    <tr key={f.unitId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {f.unitLabel}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        ${f.billedTotal.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        ${f.collectedTotal.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-red-600">
                        ${f.amount.toFixed(2)}{' '}
                        <span className="text-xs font-normal text-red-400">
                          ({Math.round(f.gapRatio * 100)}%)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <SeverityBadge severity={f.severity} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SeverityBadge({
  severity,
  t,
}: {
  severity: 'medium' | 'high';
  t: (key: string) => string;
}) {
  return severity === 'high' ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
      {t('leakResults.severityHigh')}
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
      {t('leakResults.severityMedium')}
    </span>
  );
}
