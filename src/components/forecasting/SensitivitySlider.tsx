'use client';

/**
 * src/components/forecasting/SensitivitySlider.tsx
 *
 * Client component — adjustable slider that applies a delta offset to a base
 * value and renders the resulting projected net cash flow.
 *
 * Used by the Forecasting page to let admins adjust occupancy rate ± 10%
 * and OpEx % and see the projected net profit change in real-time.
 */

import { useState } from 'react';

export interface SensitivitySliderProps {
  /** Base monthly net profit computed server-side from actual data */
  baseNetProfit: number;
  /** Base occupancy rate as a 0–1 fraction */
  baseOccupancyRate: number;
  /** Total monthly revenue at 100% occupancy (used to project income) */
  monthlyRevenueAtFullOccupancy: number;
  /** Base monthly operating expenses */
  baseMonthlyExpenses: number;
}

/** Format a number as a currency string */
function fmtCurrency(n: number): string {
  const abs = Math.abs(n);
  const formatted =
    '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-${formatted}` : formatted;
}

/** Format a 0–1 fraction as "X.X%" */
function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

export function SensitivitySlider({
  baseNetProfit,
  baseOccupancyRate,
  monthlyRevenueAtFullOccupancy,
  baseMonthlyExpenses,
}: SensitivitySliderProps) {
  // Occupancy delta in percentage points, range -10 to +10
  const [occupancyDeltaPp, setOccupancyDeltaPp] = useState(0);
  // OpEx multiplier delta in percentage points, range -20 to +20
  const [opexDeltaPp, setOpexDeltaPp] = useState(0);

  // Projected occupancy rate
  const projectedOccupancy = Math.min(1, Math.max(0, baseOccupancyRate + occupancyDeltaPp / 100));
  // Projected monthly income
  const projectedIncome =
    monthlyRevenueAtFullOccupancy > 0
      ? monthlyRevenueAtFullOccupancy * projectedOccupancy
      : // Fall back: scale current income proportionally
        baseOccupancyRate > 0
        ? (baseNetProfit + baseMonthlyExpenses) * (projectedOccupancy / baseOccupancyRate)
        : 0;
  // Projected expenses with OpEx multiplier
  const projectedExpenses = baseMonthlyExpenses * (1 + opexDeltaPp / 100);
  // Projected net cash flow
  const projectedNet = projectedIncome - projectedExpenses;

  const netDelta = projectedNet - baseNetProfit;
  const improved = netDelta >= 0;

  return (
    <div className="space-y-6">
      {/* Occupancy slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label
            htmlFor="occupancy-slider"
            className="text-sm font-medium text-slate-700"
          >
            Occupancy adjustment
          </label>
          <span className="text-sm font-semibold text-slate-800">
            {occupancyDeltaPp >= 0 ? '+' : ''}
            {occupancyDeltaPp} pp &rarr; {fmtPct(projectedOccupancy)}
          </span>
        </div>
        <input
          id="occupancy-slider"
          type="range"
          min={-10}
          max={10}
          step={1}
          value={occupancyDeltaPp}
          onChange={(e) => setOccupancyDeltaPp(Number(e.target.value))}
          className="w-full accent-brand-600"
          aria-valuemin={-10}
          aria-valuemax={10}
          aria-valuenow={occupancyDeltaPp}
          aria-valuetext={`${occupancyDeltaPp >= 0 ? '+' : ''}${occupancyDeltaPp} percentage points`}
        />
        <div className="flex justify-between text-xs text-slate-400 mt-0.5">
          <span>-10 pp</span>
          <span>0</span>
          <span>+10 pp</span>
        </div>
      </div>

      {/* OpEx slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label
            htmlFor="opex-slider"
            className="text-sm font-medium text-slate-700"
          >
            Operating expenses adjustment
          </label>
          <span className="text-sm font-semibold text-slate-800">
            {opexDeltaPp >= 0 ? '+' : ''}
            {opexDeltaPp}% &rarr; {fmtCurrency(projectedExpenses)}
          </span>
        </div>
        <input
          id="opex-slider"
          type="range"
          min={-20}
          max={20}
          step={1}
          value={opexDeltaPp}
          onChange={(e) => setOpexDeltaPp(Number(e.target.value))}
          className="w-full accent-brand-600"
          aria-valuemin={-20}
          aria-valuemax={20}
          aria-valuenow={opexDeltaPp}
          aria-valuetext={`${opexDeltaPp >= 0 ? '+' : ''}${opexDeltaPp} percent`}
        />
        <div className="flex justify-between text-xs text-slate-400 mt-0.5">
          <span>-20%</span>
          <span>0</span>
          <span>+20%</span>
        </div>
      </div>

      {/* Projected result */}
      <div
        data-testid="projected-net-cashflow"
        className={`rounded-xl border p-5 ${
          improved ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wider mb-1 text-slate-500">
          Projected Net Cash Flow
        </p>
        <p
          className={`text-3xl font-bold ${
            projectedNet >= 0 ? 'text-green-700' : 'text-red-600'
          }`}
        >
          {fmtCurrency(projectedNet)}
        </p>
        <p
          className={`text-sm mt-1 ${improved ? 'text-green-600' : 'text-red-600'}`}
        >
          {improved ? '+' : ''}
          {fmtCurrency(netDelta)} vs current actuals
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-500">
          <div>
            <span className="font-semibold">Projected income:</span>{' '}
            {fmtCurrency(projectedIncome)}
          </div>
          <div>
            <span className="font-semibold">Projected expenses:</span>{' '}
            {fmtCurrency(projectedExpenses)}
          </div>
        </div>
      </div>

      {/* Reset button */}
      {(occupancyDeltaPp !== 0 || opexDeltaPp !== 0) && (
        <button
          type="button"
          onClick={() => { setOccupancyDeltaPp(0); setOpexDeltaPp(0); }}
          className="text-xs text-slate-400 hover:text-slate-600 underline transition-colors"
        >
          Reset to actuals
        </button>
      )}
    </div>
  );
}
