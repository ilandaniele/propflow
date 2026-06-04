'use client';

import { useTranslations } from 'next-intl';

interface PricingToggleProps {
  isAnnual: boolean;
  onToggle: (annual: boolean) => void;
}

export function PricingToggle({ isAnnual, onToggle }: PricingToggleProps) {
  const t = useTranslations('landing.pricing');

  return (
    <div className="flex items-center justify-center gap-3" role="group" aria-label="Billing cycle">
      <span
        className={`text-sm font-medium transition-colors ${
          !isAnnual ? 'text-slate-900' : 'text-slate-500'
        }`}
      >
        {t('toggleMonthly')}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={isAnnual}
        aria-label={t('toggleAnnual')}
        onClick={() => onToggle(!isAnnual)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
          isAnnual ? 'bg-brand-600' : 'bg-slate-300'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            isAnnual ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>

      <span
        className={`text-sm font-medium transition-colors flex items-center gap-2 ${
          isAnnual ? 'text-slate-900' : 'text-slate-500'
        }`}
      >
        {t('toggleAnnual')}
        {isAnnual && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            {t('annualDiscount')}
          </span>
        )}
      </span>
    </div>
  );
}
