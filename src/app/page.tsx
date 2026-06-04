import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ProblemCards } from '@/components/landing/ProblemCards';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { PricingTable } from '@/components/landing/PricingTable';

export const metadata: Metadata = {
  title: 'PropFlow — Gestión de propiedades compartidas',
  description:
    'Centralizá contratos, pagos, incidentes, tareas y rentabilidad por unidad en un solo panel conectado a tus datos reales.',
  robots: { index: true, follow: true },
};

// Public landing page — renders with next-intl (default locale: es).
// next-intl getTranslations() works with static generation when locale is
// resolved from cookie at request time (non-segment approach).
export const dynamic = 'force-dynamic';

const FEATURE_CHIP_KEYS = [
  'chip1', 'chip2', 'chip3', 'chip4', 'chip5', 'chip6', 'chip7',
  'chip8', 'chip9', 'chip10', 'chip11', 'chip12', 'chip13', 'chip14',
] as const;

export default async function LandingPage() {
  const t = await getTranslations('landing');

  return (
    <div className="min-h-screen flex flex-col bg-white" lang="es">
      {/* Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <nav
          className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between"
          aria-label="Main"
        >
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold">P</span>
            </div>
            <span className="text-lg">PropFlow</span>
          </Link>

          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#problems" className="hover:text-slate-900 transition-colors">
              {t('nav.problems')}
            </a>
            <a href="#features" className="hover:text-slate-900 transition-colors">
              {t('nav.features')}
            </a>
            <a href="#pricing" className="hover:text-slate-900 transition-colors">
              {t('nav.pricing')}
            </a>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center h-9 px-4 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors shadow-sm"
            >
              {t('nav.signIn')}
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section
          className="relative overflow-hidden pt-20 pb-24 sm:pt-28 sm:pb-32"
          aria-labelledby="hero-heading"
        >
          {/* Background gradient */}
          <div
            className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-brand-50 pointer-events-none"
            aria-hidden="true"
          />
          <div
            className="absolute top-0 right-0 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"
            aria-hidden="true"
          />

          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-100 border border-brand-200 text-brand-700 text-xs font-semibold mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" aria-hidden="true" />
              {t('hero.badge')}
            </div>

            <h1
              id="hero-heading"
              className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight leading-tight mb-6"
            >
              {t('hero.headline')}
            </h1>

            <p className="max-w-2xl mx-auto text-lg sm:text-xl text-slate-600 leading-relaxed mb-10">
              {t('hero.subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-8 rounded-xl bg-brand-600 text-white font-semibold text-base hover:bg-brand-700 transition-colors shadow-lg shadow-brand-600/20"
              >
                {t('hero.ctaPrimary')}
              </Link>
              <a
                href="#pricing"
                className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-8 rounded-xl bg-white text-slate-700 font-semibold text-base border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm"
              >
                {t('hero.ctaSecondary')}
              </a>
            </div>

            <p className="mt-4 text-xs text-slate-400">
              {t('hero.noSignup')}
            </p>

            {/* Dashboard preview block — static, no real data */}
            <DashboardPreview />
          </div>
        </section>

        {/* Problem Cards — dark navy section */}
        <ProblemCards />

        {/* Features section */}
        <section
          className="py-20 sm:py-28 bg-white"
          id="features"
          aria-labelledby="features-heading"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-14">
              <h2
                id="features-heading"
                className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4"
              >
                {t('features.sectionTitle')}
              </h2>
              <p className="text-lg text-slate-600 max-w-xl mx-auto">
                {t('features.sectionSubtitle')}
              </p>
            </div>

            {/* 14 feature chips */}
            <div className="flex flex-wrap justify-center gap-3">
              {FEATURE_CHIP_KEYS.map((key) => (
                <div
                  key={key}
                  className="inline-flex items-center px-4 py-2.5 rounded-full bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors duration-150"
                  data-testid="feature-chip"
                >
                  {t(`features.${key}`)}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing section — 3 tiers + monthly/annual toggle (client component) */}
        <PricingTable />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-8 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <span className="text-white text-xs font-bold">P</span>
            </div>
            PropFlow
          </div>

          <div className="flex items-center gap-5">
            <a
              href="mailto:hello@propflow.app"
              className="hover:text-slate-900 transition-colors"
            >
              {t('footer.contact')}
            </a>
            <Link href="/login" className="hover:text-slate-900 transition-colors">
              {t('nav.signIn')}
            </Link>
          </div>

          <p>
            &copy; {new Date().getFullYear()} PropFlow. {t('footer.copyright')}
          </p>
        </div>
      </footer>
    </div>
  );
}
