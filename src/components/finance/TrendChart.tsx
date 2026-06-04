'use client';
/**
 * src/components/finance/TrendChart.tsx
 *
 * 12-month revenue vs expenses vs net profit trend chart (AC24).
 *
 * Client Component — uses SVG for rendering so there is no additional
 * chart library dependency (recharts is not installed in this project).
 *
 * i18n axis/tooltip strings are passed in as props by the Server Component
 * parent (which uses getTranslations()) so this Client Component never
 * calls useTranslations() itself (avoids hydration mismatch).
 */

import { useLocale } from 'next-intl';
import type { MonthlyTrend } from '@/lib/finance/reports';

interface TrendChartProps {
  data: MonthlyTrend[];
  /** i18n strings resolved by the Server Component parent */
  labels: {
    revenue: string;
    expenses: string;
    netProfit: string;
    title: string;
    noData: string;
  };
}

const CHART_HEIGHT = 200;
const CHART_PADDING_TOP = 16;
const CHART_PADDING_BOTTOM = 32; // room for month labels
const CHART_PADDING_LEFT = 64;  // room for Y-axis labels
const CHART_PADDING_RIGHT = 16;

const COLORS = {
  revenue: '#22c55e',   // green-500
  expenses: '#ef4444',  // red-500
  net: '#3b82f6',       // blue-500
};

function formatMonthLabel(ym: string, locale: string): string {
  // 'YYYY-MM' → locale-aware 3-letter month abbreviation
  const [year, mm] = ym.split('-');
  const date = new Date(parseInt(year, 10), parseInt(mm, 10) - 1, 1);
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
}

function formatAmount(n: number): string {
  if (Math.abs(n) >= 1000) {
    return '$' + (n / 1000).toFixed(1) + 'k';
  }
  return '$' + n.toFixed(0);
}

export function TrendChart({ data, labels }: TrendChartProps) {
  const locale = useLocale();
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
        {labels.noData}
      </div>
    );
  }

  // Compute scale
  const allValues = data.flatMap((d) => [d.grossIncome, d.totalExpenses, d.trueNetProfit]);
  const maxVal = Math.max(...allValues, 0);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const plotHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  // Dynamically compute width per bar group from data length
  const totalBars = data.length;

  function toY(v: number): number {
    // SVG Y-axis is inverted (0 is top)
    return CHART_PADDING_TOP + plotHeight - ((v - minVal) / range) * plotHeight;
  }

  // Build polyline points string for a series
  function seriesPoints(key: 'grossIncome' | 'totalExpenses' | 'trueNetProfit', totalWidth: number): string {
    return data
      .map((d, i) => {
        const x = CHART_PADDING_LEFT + (i + 0.5) * ((totalWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT) / totalBars);
        const y = toY(d[key]);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  // Zero line Y position
  const zeroY = toY(0);

  return (
    <div className="w-full">
      <p className="text-sm font-semibold text-slate-700 mb-3">{labels.title}</p>

      {/* Legend */}
      <div className="flex gap-4 mb-3 flex-wrap">
        {([
          { key: 'revenue', color: COLORS.revenue, label: labels.revenue },
          { key: 'expenses', color: COLORS.expenses, label: labels.expenses },
          { key: 'net', color: COLORS.net, label: labels.netProfit },
        ] as const).map(({ key, color, label }) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="inline-block w-3 h-2 rounded-sm"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            {label}
          </div>
        ))}
      </div>

      {/* Responsive SVG wrapper */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 800 ${CHART_HEIGHT}`}
          role="img"
          aria-label={labels.title}
          className="w-full"
          style={{ minWidth: '400px' }}
        >
          {/* Y-axis grid lines + labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const v = minVal + ratio * range;
            const y = CHART_PADDING_TOP + plotHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={CHART_PADDING_LEFT}
                  y1={y}
                  x2={800 - CHART_PADDING_RIGHT}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
                <text
                  x={CHART_PADDING_LEFT - 4}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="9"
                  fill="#94a3b8"
                >
                  {formatAmount(v)}
                </text>
              </g>
            );
          })}

          {/* Zero line (may differ from bottom grid line when net is negative) */}
          {minVal < 0 && (
            <line
              x1={CHART_PADDING_LEFT}
              y1={zeroY}
              x2={800 - CHART_PADDING_RIGHT}
              y2={zeroY}
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
          )}

          {/* Revenue line */}
          <polyline
            points={seriesPoints('grossIncome', 800)}
            fill="none"
            stroke={COLORS.revenue}
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {/* Expenses line */}
          <polyline
            points={seriesPoints('totalExpenses', 800)}
            fill="none"
            stroke={COLORS.expenses}
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {/* Net profit line */}
          <polyline
            points={seriesPoints('trueNetProfit', 800)}
            fill="none"
            stroke={COLORS.net}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeDasharray="6 2"
          />

          {/* Data points + tooltips */}
          {data.map((d, i) => {
            const plotWidth = 800 - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
            const x = CHART_PADDING_LEFT + (i + 0.5) * (plotWidth / totalBars);

            return (
              <g key={d.month}>
                {/* Revenue dot */}
                <circle cx={x} cy={toY(d.grossIncome)} r="3" fill={COLORS.revenue}>
                  <title>{`${formatMonthLabel(d.month, locale)} — ${labels.revenue}: ${formatAmount(d.grossIncome)}`}</title>
                </circle>
                {/* Expenses dot */}
                <circle cx={x} cy={toY(d.totalExpenses)} r="3" fill={COLORS.expenses}>
                  <title>{`${formatMonthLabel(d.month, locale)} — ${labels.expenses}: ${formatAmount(d.totalExpenses)}`}</title>
                </circle>
                {/* Net dot */}
                <circle cx={x} cy={toY(d.trueNetProfit)} r="3" fill={COLORS.net}>
                  <title>{`${formatMonthLabel(d.month, locale)} — ${labels.netProfit}: ${formatAmount(d.trueNetProfit)}`}</title>
                </circle>

                {/* X-axis month label */}
                <text
                  x={x}
                  y={CHART_HEIGHT - 8}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#94a3b8"
                >
                  {formatMonthLabel(d.month, locale)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
