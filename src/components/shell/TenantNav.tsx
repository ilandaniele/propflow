'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/app/actions/auth';
import { useTransition } from 'react';

const navItems = [
  {
    label: 'Overview',
    href: '/portal',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>
      </svg>
    ),
  },
  {
    label: 'Contract',
    href: '/portal/contract',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
    ),
  },
  {
    label: 'Payments',
    href: '/portal/payments',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
      </svg>
    ),
  },
  {
    label: 'Incidents',
    href: '/portal/incidents',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
    ),
  },
];

interface TenantNavProps {
  userName?: string | null;
}

export function TenantNav({ userName }: TenantNavProps) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      {/* Desktop top nav */}
      <header className="hidden sm:flex h-14 bg-white border-b border-slate-200 items-center justify-between px-6 shrink-0">
        <Link href="/portal" className="flex items-center gap-2 font-semibold text-slate-900">
          <div className="h-6 w-6 rounded-md bg-brand-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">P</span>
          </div>
          PropFlow
        </Link>
        <nav className="flex items-center gap-1" aria-label="Tenant navigation">
          {navItems.map((item) => {
            const isActive = item.href === '/portal' ? pathname === '/portal' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">{userName}</span>
          <button
            onClick={() => startTransition(() => signOut())}
            disabled={isPending}
            className="text-sm text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
            data-testid="logout-button"
          >
            {isPending ? '...' : 'Sign out'}
          </button>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50"
        aria-label="Mobile tenant navigation"
      >
        <ul className="flex" role="list">
          {navItems.map((item) => {
            const isActive = item.href === '/portal' ? pathname === '/portal' : pathname.startsWith(item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={[
                    'flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors',
                    isActive ? 'text-brand-600' : 'text-slate-500',
                  ].join(' ')}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
