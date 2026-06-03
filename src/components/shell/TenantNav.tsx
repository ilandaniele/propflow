'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/app/actions/auth';
import { LanguageDropdown } from '@/components/i18n/LanguageDropdown';
import { NotificationBadge } from '@/components/portal/NotificationBadge';
import { useTransition } from 'react';
import type { Locale } from '@/i18n/config';

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
  {
    label: 'Notices',
    href: '/portal/announcements',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.88 15 19.79 19.79 0 0 1 1.85 6.39a2 2 0 0 1 1.98-2.18h3a2 2 0 0 1 2 1.72"/><polyline points="22 2 12 12"/>
      </svg>
    ),
  },
  {
    label: 'Community',
    href: '/portal/community',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    label: 'Tasks',
    href: '/portal/tasks',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
  },
  {
    label: 'Sanctions',
    href: '/portal/sanctions',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ),
  },
];

// Mobile bottom nav shows first 4; all items appear in desktop top-nav
const mobileNavItems = navItems.slice(0, 4);

interface TenantNavProps {
  userName?: string | null;
  /**
   * profileId is no longer used to pass unreadCount from the server —
   * NotificationBadge fetches the count client-side on mount (spec AC4).
   * The prop is kept for potential future use (e.g. Supabase Realtime subscriptions).
   */
  profileId?: string;
  currentLocale?: Locale;
}

export function TenantNav({ userName, currentLocale = 'es' }: TenantNavProps) {
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
          {/* Notification bell — count fetched client-side (spec AC4) */}
          <NotificationBadge variant="desktop" />

          <LanguageDropdown currentLocale={currentLocale} />
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

      {/* Mobile bottom nav (first 4 items) */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50"
        aria-label="Mobile tenant navigation"
      >
        <ul className="flex" role="list">
          {mobileNavItems.map((item) => {
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
          {/* Notification bell on mobile — count fetched client-side (spec AC4) */}
          <li className="flex-1">
            <NotificationBadge variant="mobile" />
          </li>
        </ul>
      </nav>
    </>
  );
}
