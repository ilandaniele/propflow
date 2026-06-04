'use client';

/**
 * NarrativeSection — client component that lets admin generate and display
 * the AI narrative for the Executive Brief (AC13).
 *
 * Uses /api/ai/executive-brief (W7). Output is rendered via Narrative.tsx
 * which uses react-markdown + rehype-sanitize — never dangerouslySetInnerHTML.
 *
 * Disclaimer shown below narrative per LLM09 spec requirement.
 */

import { useState } from 'react';
import { Narrative } from './Narrative';

export function NarrativeSection() {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/executive-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setMarkdown(data.markdown ?? '');
    } catch {
      setError('Error de red. Inténtalo de nuevo.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Narrativa generada por IA
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Resumen de Wins y Leaks basado en KPIs del portfolio (sin datos personales)
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isLoading}
          className={[
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            isLoading
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-brand-600 text-white hover:bg-brand-700',
          ].join(' ')}
        >
          {isLoading ? 'Generando...' : 'Generar narrativa'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Narrative output */}
      {markdown !== null && (
        <div className="space-y-3">
          <Narrative
            markdown={markdown}
            className="prose prose-sm prose-slate max-w-none [&>h2]:text-sm [&>h2]:font-semibold [&>h2]:text-slate-800 [&>h2]:mt-4 [&>h2]:mb-2 [&>ul]:text-slate-600 [&>p]:text-slate-600"
          />
          {/* LLM09: disclaimer */}
          <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
            Resumen generado por IA — verificar antes de actuar. Los datos son agregados y no incluyen información personal.
          </p>
        </div>
      )}

      {/* Empty state before first generation */}
      {markdown === null && !isLoading && !error && (
        <div className="py-8 text-center">
          <p className="text-sm text-slate-400">
            Haz clic en &quot;Generar narrativa&quot; para obtener un análisis de Wins y Leaks de tu portfolio.
          </p>
        </div>
      )}
    </div>
  );
}
