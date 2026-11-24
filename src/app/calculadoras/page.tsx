import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Calculators } from './Calculators';

export const metadata: Metadata = {
  title: 'Calculadoras de alquiler — rentabilidad, reajuste y reparto de gastos | PropFlow',
  description:
    'Calculadoras gratuitas para propietarios: rentabilidad bruta y neta de un alquiler, reajuste de renta por porcentaje y reparto de gastos comunes por unidad o por m².',
  robots: { index: true, follow: true },
  alternates: { canonical: '/calculadoras' },
};

export const dynamic = 'force-dynamic';

export default async function CalculatorsPage() {
  const t = await getTranslations('calculators');
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold">P</span>
            </div>
            <span className="text-lg">PropFlow</span>
          </Link>
          <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
            {t('cta')}
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-slate-600">{t('intro')}</p>
        </div>
        <Calculators />
        <p className="text-xs text-slate-500">{t('disclaimer')}</p>
      </main>
    </div>
  );
}
