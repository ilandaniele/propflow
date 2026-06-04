/**
 * src/lib/analyst/index.ts
 *
 * Analyst dispatcher — AC15.
 *
 * Maps a prompt slug to a deterministic TypeScript function. No LLM is called.
 * Results are returned as structured AnalystResult objects for rendering.
 *
 * SERVER-ONLY: never import from client components.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  getWorstPerformingRooms,
  getLostDebtThisMonth,
  getHighestExpenseProperties,
  getRentToMarketGap,
  getMonthlyVs3MonthTrend,
  getHighestRiskTenants,
} from './top-underperformers';

// ---------------------------------------------------------------------------
// Prompt slugs
// ---------------------------------------------------------------------------

export const ANALYST_PROMPT_SLUGS = [
  'worst_performing_rooms',
  'lost_debt_this_month',
  'highest_expense_property',
  'rent_to_market_gap',
  'monthly_vs_3month_trend',
  'highest_risk_tenants',
] as const;

export type AnalystPromptSlug = (typeof ANALYST_PROMPT_SLUGS)[number];

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface AnalystResult {
  slug: AnalystPromptSlug;
  question: string;
  answer: string;
  /** Tabular data rows — shape depends on slug */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally flexible: each slug returns a different row shape; callers are expected to narrow the type per slug
  data: any[];
  columns?: string[];
  source: 'deterministic';
}

// ---------------------------------------------------------------------------
// Human-readable question labels (Spanish — primary locale)
// ---------------------------------------------------------------------------

const QUESTION_LABELS: Record<AnalystPromptSlug, string> = {
  worst_performing_rooms: '¿Cuáles son los 5 cuartos con peor rendimiento en los últimos 30 días?',
  lost_debt_this_month: '¿Cuál es mi deuda perdida real este mes?',
  highest_expense_property: '¿Qué propiedad tiene los gastos más altos?',
  rent_to_market_gap: '¿Cuánto estoy cobrando de renta respecto al mercado?',
  monthly_vs_3month_trend: '¿Cómo está mi ingreso neto este mes vs el promedio de 3 meses?',
  highest_risk_tenants: '¿Qué inquilinos representan el mayor riesgo financiero?',
};

export function getPromptLabel(slug: AnalystPromptSlug): string {
  return QUESTION_LABELS[slug];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function analyzePortfolio(
  supabase: SupabaseClient,
  orgId: string,
  slug: AnalystPromptSlug,
): Promise<AnalystResult> {
  const question = QUESTION_LABELS[slug];

  switch (slug) {
    case 'worst_performing_rooms': {
      const rows = await getWorstPerformingRooms(supabase, orgId, 5);
      const answer =
        rows.length === 0
          ? 'No hay datos suficientes para los últimos 30 días.'
          : `Se encontraron ${rows.length} cuartos con deuda pendiente. El peor es "${rows[0].unitLabel}" con ${(rows[0].lossRatio * 100).toFixed(1)}% de pérdida sobre lo facturado.`;
      return {
        slug,
        question,
        answer,
        data: rows,
        columns: ['Cuarto', 'Propiedad', 'Facturado', 'Cobrado', 'Neto', '% Pérdida'],
        source: 'deterministic',
      };
    }

    case 'lost_debt_this_month': {
      const summary = await getLostDebtThisMonth(supabase, orgId);
      const answer =
        summary.overdueCount === 0
          ? 'No hay inquilinos con saldo vencido este mes.'
          : `Hay ${summary.overdueCount} inquilino(s) con saldo vencido. Total de deuda: $${summary.totalOverdueAmount.toFixed(2)}.`;
      return {
        slug,
        question,
        answer,
        data: [summary],
        columns: ['Total deuda vencida', 'Inquilinos con saldo vencido'],
        source: 'deterministic',
      };
    }

    case 'highest_expense_property': {
      const rows = await getHighestExpenseProperties(supabase, orgId, 5);
      const answer =
        rows.length === 0
          ? 'No hay gastos registrados en los últimos 30 días.'
          : `La propiedad con más gastos es "${rows[0].propertyName}" con $${rows[0].totalExpenses.toFixed(2)} en los últimos 30 días.`;
      return {
        slug,
        question,
        answer,
        data: rows,
        columns: ['Propiedad', 'Total gastos (30d)'],
        source: 'deterministic',
      };
    }

    case 'rent_to_market_gap': {
      const { rows, hasMarketData } = await getRentToMarketGap(supabase, orgId);
      const answer = hasMarketData
        ? `Análisis de brecha renta/mercado para ${rows.length} unidades.`
        : 'No hay datos de precio de mercado disponibles. Agrega un campo "market_rate" a las unidades para activar este análisis.';
      return {
        slug,
        question,
        answer,
        data: rows,
        columns: hasMarketData
          ? ['Unidad', 'Renta actual', 'Precio mercado', 'Brecha']
          : [],
        source: 'deterministic',
      };
    }

    case 'monthly_vs_3month_trend': {
      const rows = await getMonthlyVs3MonthTrend(supabase, orgId);
      const current = rows.find((r) => r.period === 'current_month');
      const avg = rows.find((r) => r.period === 'rolling_3_month_avg');
      let answer = 'Datos de tendencia no disponibles.';
      if (current && avg) {
        const diff = current.net - avg.net;
        const direction = diff >= 0 ? 'por encima' : 'por debajo';
        answer = `El ingreso neto de este mes ($${current.net.toFixed(2)}) está ${direction} del promedio de 3 meses ($${avg.net.toFixed(2)}). Diferencia: ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}.`;
      }
      return {
        slug,
        question,
        answer,
        data: rows,
        columns: ['Período', 'Ingresos', 'Gastos', 'Neto'],
        source: 'deterministic',
      };
    }

    case 'highest_risk_tenants': {
      const rows = await getHighestRiskTenants(supabase, orgId, 5);
      const answer =
        rows.length === 0
          ? 'No se detectaron inquilinos con riesgo elevado.'
          : `Se identificaron ${rows.length} inquilino(s) de alto riesgo. El de mayor riesgo tiene saldo vencido de $${rows[0].overdueBalance.toFixed(2)} e incidentes abiertos: ${rows[0].openIncidents}.`;
      return {
        slug,
        question,
        answer,
        data: rows,
        columns: ['Cuarto', 'Saldo vencido', 'Incidentes abiertos', 'Puntaje de riesgo'],
        source: 'deterministic',
      };
    }

    default: {
      const _exhaustive: never = slug;
      throw new Error(`Unknown analyst slug: ${_exhaustive}`);
    }
  }
}
