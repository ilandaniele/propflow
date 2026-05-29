import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'PropFlow — Modern Property Management',
  description: 'A premium platform for property managers and tenants. Manage properties, contracts, payments, and incidents with confidence.',
  robots: { index: true, follow: true },
};

// Public landing page — SSG, no auth required
export const dynamic = 'force-static';

const features = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    title: 'Multi-property Management',
    description: 'Organize your entire portfolio — multiple properties, units, and tenants — under one unified platform with strict data isolation.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>
      </svg>
    ),
    title: 'Contracts & Tenants',
    description: 'Create and track lease contracts with clear term dates and monthly rent. Keep a full record of every tenant relationship.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
      </svg>
    ),
    title: 'Payments & Account Statements',
    description: 'Record payments, track charges, and see live balance per tenant. Approval workflow keeps your financials accurate and auditable.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
    ),
    title: 'Incident Tracking',
    description: 'Linear-style incident management with priorities, assignments, and comment threads. Tenants report issues; you resolve them.',
  },
];

const stats = [
  { value: '100%', label: 'Data isolation' },
  { value: 'ASVS L2', label: 'Security baseline' },
  { value: 'Real-time', label: 'Incident updates' },
  { value: '$0', label: 'To get started' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between" aria-label="Main">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold">P</span>
            </div>
            <span className="text-lg">PropFlow</span>
          </Link>

          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#security" className="hover:text-slate-900 transition-colors">Security</a>
            <a href="#pricing" className="hover:text-slate-900 transition-colors">Pricing</a>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`mailto:hello@propflow.app?subject=Request Access to PropFlow`}
              className="hidden sm:inline-flex text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Request access
            </a>
            <Link
              href="/login"
              className="inline-flex items-center h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors shadow-sm"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden pt-20 pb-24 sm:pt-28 sm:pb-32">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-violet-50 pointer-events-none" aria-hidden="true" />
          <div className="absolute top-0 right-0 w-96 h-96 bg-violet-100/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" aria-hidden="true" />

          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" aria-hidden="true" />
              Core Operations MVP — Now Available
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight leading-tight mb-6">
              Property management,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-indigo-600">
                built right
              </span>
            </h1>

            <p className="max-w-2xl mx-auto text-lg sm:text-xl text-slate-600 leading-relaxed mb-10">
              PropFlow gives property managers a single platform to manage properties, tenants,
              contracts, payments, and incidents — with strict multi-tenant data isolation
              and a premium tenant portal.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-8 rounded-xl bg-slate-900 text-white font-semibold text-base hover:bg-slate-700 transition-colors shadow-lg shadow-slate-900/10"
              >
                Sign in to your account
              </Link>
              <a
                href="mailto:hello@propflow.app?subject=Request Access to PropFlow"
                className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-8 rounded-xl bg-white text-slate-700 font-semibold text-base border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm"
              >
                Request access
              </a>
            </div>

            <p className="mt-4 text-xs text-slate-400">
              No public sign-up. Access is provisioned by your property manager.
            </p>

            {/* Mock dashboard preview */}
            <div className="mt-16 relative mx-auto max-w-4xl">
              <div className="rounded-2xl border border-slate-200 shadow-2xl shadow-slate-900/10 overflow-hidden bg-slate-50">
                {/* Mock browser bar */}
                <div className="h-9 bg-white border-b border-slate-200 flex items-center px-4 gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-slate-200" />
                    <div className="w-3 h-3 rounded-full bg-slate-200" />
                    <div className="w-3 h-3 rounded-full bg-slate-200" />
                  </div>
                  <div className="flex-1 mx-4 h-5 bg-slate-100 rounded text-xs text-slate-400 flex items-center px-2">
                    propflow.vercel.app/dashboard
                  </div>
                </div>
                {/* Mock dashboard content */}
                <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Occupancy', value: '87%', color: 'text-green-600' },
                    { label: 'Rent Collected', value: '$12,400', color: 'text-violet-600' },
                    { label: 'Open Incidents', value: '3', color: 'text-amber-600' },
                    { label: 'Overdue Tenants', value: '1', color: 'text-red-600' },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 p-4">
                      <p className="text-xs text-slate-500 mb-1">{kpi.label}</p>
                      <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-12 bg-slate-900" id="security" aria-labelledby="stats-heading">
          <h2 id="stats-heading" className="sr-only">Platform statistics</h2>
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            {stats.map((stat) => (
              <div key={stat.label}>
                <p className="text-2xl sm:text-3xl font-bold text-white">{stat.value}</p>
                <p className="text-sm text-slate-400 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="py-20 sm:py-28" id="features" aria-labelledby="features-heading">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-14">
              <h2 id="features-heading" className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                Everything your team needs
              </h2>
              <p className="text-lg text-slate-600 max-w-xl mx-auto">
                From portfolio overview to tenant incidents — built for the complete property management workflow.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="group relative bg-white rounded-2xl border border-slate-200 p-7 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-200"
                >
                  <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-violet-50 text-violet-600 mb-5 group-hover:bg-violet-100 transition-colors">
                    {feature.icon}
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Social proof placeholder */}
        <section className="py-16 bg-slate-50 border-y border-slate-200" aria-label="Testimonials">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
              {[
                {
                  quote: "PropFlow cut our management overhead in half. The incident tracker alone saves us hours every week.",
                  author: "Maria G.",
                  role: "Property Manager, 45 units",
                },
                {
                  quote: "Finally a platform that actually isolates our tenant data. The payment approval flow is exactly what we needed.",
                  author: "Carlos R.",
                  role: "Real Estate Manager",
                },
                {
                  quote: "The tenant portal is clean and intuitive. Our tenants love being able to track their payments and report issues.",
                  author: "Ana L.",
                  role: "Building Administrator",
                },
              ].map((testimonial) => (
                <blockquote key={testimonial.author} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                  <p className="text-sm text-slate-700 leading-relaxed mb-4">&ldquo;{testimonial.quote}&rdquo;</p>
                  <footer>
                    <cite className="not-italic">
                      <p className="text-sm font-semibold text-slate-900">{testimonial.author}</p>
                      <p className="text-xs text-slate-500">{testimonial.role}</p>
                    </cite>
                  </footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 sm:py-28" id="pricing" aria-labelledby="cta-heading">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
            <h2 id="cta-heading" className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Ready to get started?
            </h2>
            <p className="text-lg text-slate-600 mb-8">
              PropFlow is currently in private access. Sign in if you have an account,
              or request access and we&apos;ll get you set up.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-8 rounded-xl bg-slate-900 text-white font-semibold text-base hover:bg-slate-700 transition-colors shadow-lg"
              >
                Sign in
              </Link>
              <a
                href="mailto:hello@propflow.app?subject=Request Access to PropFlow"
                className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-8 rounded-xl bg-white text-slate-700 font-semibold text-base border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Request access
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-8 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">P</span>
            </div>
            PropFlow
          </div>
          <div className="flex items-center gap-5">
            <a
              href="mailto:hello@propflow.app"
              className="hover:text-slate-900 transition-colors"
            >
              Contact
            </a>
            <Link href="/login" className="hover:text-slate-900 transition-colors">
              Sign in
            </Link>
          </div>
          <p>&copy; {new Date().getFullYear()} PropFlow. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
