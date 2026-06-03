'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PricingToggle } from './PricingToggle';

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-violet-600 shrink-0 mt-0.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

interface TierCardProps {
  name: string;
  tagline: string;
  price: string;
  priceSuffix: string;
  bullets: string[];
  cta: string;
  ctaHref: string;
  badge?: string;
  highlight?: boolean;
}

function TierCard({ name, tagline, price, priceSuffix, bullets, cta, ctaHref, badge, highlight }: TierCardProps) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-7 transition-shadow duration-200 ${
        highlight
          ? 'border-violet-500 shadow-xl shadow-violet-500/10 bg-white'
          : 'border-slate-200 bg-white hover:shadow-lg'
      }`}
      data-testid="pricing-tier"
    >
      {badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-violet-600 text-white shadow-sm">
            {badge}
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-bold text-slate-900">{name}</h3>
        <p className="text-sm text-slate-500 mt-1">{tagline}</p>
      </div>

      <div className="mb-6">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-slate-900">{price}</span>
          {priceSuffix && (
            <span className="text-sm text-slate-500">{priceSuffix}</span>
          )}
        </div>
      </div>

      <ul className="space-y-3 mb-8 flex-1" role="list">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2.5 text-sm text-slate-700">
            <CheckIcon />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <a
        href={ctaHref}
        className={`inline-flex items-center justify-center h-11 px-6 rounded-xl text-sm font-semibold transition-colors ${
          highlight
            ? 'bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-500/20'
            : 'bg-slate-900 text-white hover:bg-slate-700'
        }`}
      >
        {cta}
      </a>
    </div>
  );
}

export function PricingTable() {
  const t = useTranslations('landing.pricing');
  const [isAnnual, setIsAnnual] = useState(false);

  const tiers = [
    {
      name: t('starter.name'),
      tagline: t('starter.tagline'),
      price: isAnnual ? t('starter.priceAnnual') : t('starter.price'),
      priceSuffix: isAnnual ? t('starter.priceSuffixAnnual') : t('starter.priceSuffix'),
      bullets: [
        t('starter.bullet1'),
        t('starter.bullet2'),
        t('starter.bullet3'),
        t('starter.bullet4'),
      ],
      cta: t('starter.cta'),
      ctaHref: '/login',
      highlight: false,
      badge: undefined,
    },
    {
      name: t('pro.name'),
      tagline: t('pro.tagline'),
      price: isAnnual ? t('pro.priceAnnual') : t('pro.price'),
      priceSuffix: isAnnual ? t('pro.priceSuffixAnnual') : t('pro.priceSuffix'),
      bullets: [
        t('pro.bullet1'),
        t('pro.bullet2'),
        t('pro.bullet3'),
        t('pro.bullet4'),
      ],
      cta: t('pro.cta'),
      ctaHref: 'mailto:hello@propflow.app?subject=PropFlow Pro',
      highlight: true,
      badge: t('pro.badge'),
    },
    {
      name: t('enterprise.name'),
      tagline: t('enterprise.tagline'),
      price: isAnnual ? t('enterprise.priceAnnual') : t('enterprise.price'),
      priceSuffix: isAnnual ? t('enterprise.priceSuffixAnnual') : t('enterprise.priceSuffix'),
      bullets: [
        t('enterprise.bullet1'),
        t('enterprise.bullet2'),
        t('enterprise.bullet3'),
        t('enterprise.bullet4'),
      ],
      cta: t('enterprise.cta'),
      ctaHref: 'mailto:hello@propflow.app?subject=PropFlow Enterprise',
      highlight: false,
      badge: undefined,
    },
  ];

  return (
    <section
      className="py-20 sm:py-28 bg-slate-50 border-y border-slate-200"
      id="pricing"
      aria-labelledby="pricing-heading"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2
            id="pricing-heading"
            className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4"
          >
            {t('sectionTitle')}
          </h2>
          <p className="text-lg text-slate-600 max-w-xl mx-auto mb-8">
            {t('sectionSubtitle')}
          </p>

          <PricingToggle isAnnual={isAnnual} onToggle={setIsAnnual} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-10">
          {tiers.map((tier) => (
            <TierCard key={tier.name} {...tier} />
          ))}
        </div>
      </div>
    </section>
  );
}
