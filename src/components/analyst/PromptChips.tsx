'use client';

/**
 * src/components/analyst/PromptChips.tsx
 *
 * Suggested prompt chips — AC15.
 *
 * Each chip executes a deterministic Server Action (no LLM call).
 * Results are rendered as a structured result card.
 */

import { useState, useTransition } from 'react';
import { runDeterministicAnalysis } from '@/app/actions/analyst';
import type { AnalystResult } from '@/lib/analyst/index';

// ---------------------------------------------------------------------------
// Chip definitions (label shown in UI → slug sent to server action)
// ---------------------------------------------------------------------------

const CHIPS: Array<{ label: string; slug: string }> = [
  { label: '¿Cuáles son los 5 cuartos con peor rendimiento?', slug: 'worst_performing_rooms' },
  { label: '¿Cuál es mi deuda perdida real este mes?', slug: 'lost_debt_this_month' },
  { label: '¿Qué propiedad tiene los gastos más altos?', slug: 'highest_expense_property' },
  { label: '¿Cuánto cobro vs el mercado?', slug: 'rent_to_market_gap' },
  { label: '¿Cómo está mi ingreso vs el promedio de 3 meses?', slug: 'monthly_vs_3month_trend' },
  { label: '¿Qué inquilinos representan mayor riesgo financiero?', slug: 'highest_risk_tenants' },
];

// ---------------------------------------------------------------------------
// Result card component
// ---------------------------------------------------------------------------

function ResultCard({ result }: { result: AnalystResult }) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm"
      role="region"
      aria-label={`Resultado: ${result.question}`}
    >
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
        Análisis determinístico
      </p>
      <h3 className="text-sm font-semibold text-slate-800 mb-2">{result.question}</h3>
      <p className="text-sm text-slate-700 mb-4">{result.answer}</p>

      {result.data && result.data.length > 0 && result.columns && result.columns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                {result.columns.map((col) => (
                  <th
                    key={col}
                    className="text-left text-slate-500 font-semibold py-1.5 px-2 border-b border-slate-100"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.data.map((row, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  {renderRow(result.slug, row)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3 italic">
        Fuente: cálculo determinístico — sin IA generativa
      </p>
    </div>
  );
}

function renderRow(slug: string, row: Record<string, unknown>) {
  switch (slug) {
    case 'worst_performing_rooms':
      return (
        <>
          <td className="py-1.5 px-2 font-medium text-slate-800">{String(row.unitLabel ?? '')}</td>
          <td className="py-1.5 px-2 text-slate-600">{String(row.propertyName ?? '')}</td>
          <td className="py-1.5 px-2 text-slate-600">${Number(row.billed ?? 0).toFixed(2)}</td>
          <td className="py-1.5 px-2 text-green-700">${Number(row.collected ?? 0).toFixed(2)}</td>
          <td className={`py-1.5 px-2 font-medium ${Number(row.net ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            ${Number(row.net ?? 0).toFixed(2)}
          </td>
          <td className="py-1.5 px-2 text-red-600 font-medium">
            {(Number(row.lossRatio ?? 0) * 100).toFixed(1)}%
          </td>
        </>
      );

    case 'lost_debt_this_month':
      return (
        <>
          <td className="py-1.5 px-2 font-medium text-red-600">
            ${Number(row.totalOverdueAmount ?? 0).toFixed(2)}
          </td>
          <td className="py-1.5 px-2 text-slate-700">{String(row.overdueCount ?? 0)}</td>
        </>
      );

    case 'highest_expense_property':
      return (
        <>
          <td className="py-1.5 px-2 font-medium text-slate-800">{String(row.propertyName ?? '')}</td>
          <td className="py-1.5 px-2 text-red-600 font-medium">
            ${Number(row.totalExpenses ?? 0).toFixed(2)}
          </td>
        </>
      );

    case 'rent_to_market_gap':
      return (
        <>
          <td className="py-1.5 px-2 font-medium text-slate-800">{String(row.unitLabel ?? '')}</td>
          <td className="py-1.5 px-2 text-slate-600">${Number(row.monthlyRent ?? 0).toFixed(2)}</td>
          <td className="py-1.5 px-2 text-slate-600">
            {row.marketRate != null ? `$${Number(row.marketRate).toFixed(2)}` : '—'}
          </td>
          <td className={`py-1.5 px-2 font-medium ${row.gap == null ? 'text-slate-400' : Number(row.gap) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {row.gap == null ? '—' : `${Number(row.gap) >= 0 ? '+' : ''}$${Number(row.gap).toFixed(2)}`}
          </td>
        </>
      );

    case 'monthly_vs_3month_trend':
      return (
        <>
          <td className="py-1.5 px-2 font-medium text-slate-800">
            {row.period === 'current_month' ? 'Mes actual' : 'Promedio 3 meses'}
          </td>
          <td className="py-1.5 px-2 text-green-700">${Number(row.revenue ?? 0).toFixed(2)}</td>
          <td className="py-1.5 px-2 text-red-600">${Number(row.expenses ?? 0).toFixed(2)}</td>
          <td className={`py-1.5 px-2 font-medium ${Number(row.net ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            ${Number(row.net ?? 0).toFixed(2)}
          </td>
        </>
      );

    case 'highest_risk_tenants':
      return (
        <>
          <td className="py-1.5 px-2 font-medium text-slate-800">{String(row.unitLabel ?? '')}</td>
          <td className="py-1.5 px-2 text-red-600">${Number(row.overdueBalance ?? 0).toFixed(2)}</td>
          <td className="py-1.5 px-2 text-amber-600">{String(row.openIncidents ?? 0)}</td>
          <td className="py-1.5 px-2 font-semibold text-slate-700">
            {Number(row.riskScore ?? 0).toFixed(1)}
          </td>
        </>
      );

    default:
      return (
        <td className="py-1.5 px-2 text-slate-500" colSpan={6}>
          {JSON.stringify(row)}
        </td>
      );
  }
}

// ---------------------------------------------------------------------------
// Main PromptChips component
// ---------------------------------------------------------------------------

export function PromptChips() {
  const [isPending, startTransition] = useTransition();
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [result, setResult] = useState<AnalystResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleChipClick(slug: string) {
    if (isPending) return;
    setActiveSlug(slug);
    setResult(null);
    setError(null);

    startTransition(async () => {
      const res = await runDeterministicAnalysis(slug);
      if (res.error) {
        setError(res.error.message ?? 'Error al ejecutar el análisis.');
      } else if (res.data) {
        setResult(res.data);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Chips */}
      <div className="flex flex-wrap gap-2">
        {CHIPS.map(({ label, slug }) => (
          <button
            key={slug}
            type="button"
            onClick={() => handleChipClick(slug)}
            disabled={isPending}
            aria-pressed={activeSlug === slug}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              activeSlug === slug
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            {label}
            {isPending && activeSlug === slug && (
              <span className="ml-1.5 inline-block w-1 h-3 bg-white animate-pulse rounded-sm" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isPending && (
        <div
          className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500"
          role="status"
          aria-live="polite"
        >
          Calculando...
        </div>
      )}

      {/* Error */}
      {error && !isPending && (
        <div
          className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Result card */}
      {result && !isPending && <ResultCard result={result} />}
    </div>
  );
}
