'use client';

/**
 * src/components/import/Tabs.tsx
 *
 * Client component — renders the 7-tab navigation for the admin import section.
 * Uses usePathname() to highlight the active tab.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  label: string;
  href: string;
}

const TABS: Tab[] = [
  { label: 'CSV Mensual',       href: '/dashboard/admin/import/csv' },
  { label: 'Rendimiento',       href: '/dashboard/admin/import/room-performance' },
  { label: 'Historial',         href: '/dashboard/admin/import/logs' },
  { label: 'Cuartos fantasma',  href: '/dashboard/admin/import/phantom-rooms' },
  { label: 'Mapeo propiedades', href: '/dashboard/admin/import/property-mapping' },
  { label: 'Mapeo cuentas',     href: '/dashboard/admin/import/account-mapping' },
  { label: 'Verificar archivo', href: '/dashboard/admin/import/check-files' },
];

export function ImportTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="flex gap-1 border-b border-slate-200 overflow-x-auto"
      aria-label="Import section tabs"
    >
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              'whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-100',
              isActive
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
            ].join(' ')}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
