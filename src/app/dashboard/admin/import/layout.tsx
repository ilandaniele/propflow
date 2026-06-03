/**
 * src/app/dashboard/admin/import/layout.tsx
 *
 * Admin Import section layout.
 * - requireAdmin() guard
 * - Renders the 7-tab navigation for the import sub-section
 *
 * Tabs:
 *   Monthly CSV | Room Performance | Import Logs | Phantom Rooms |
 *   Property Mapping | Account Mapping | Check Files
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { ImportTabs } from '@/components/import/Tabs';

export default async function AdminImportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireAdmin();
  } catch {
    redirect('/login');
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Importación de Datos</h1>
        <p className="text-sm text-slate-500 mt-1">
          Importa datos mensuales de facturación, rendimiento de habitaciones y gestiona mapeos.
        </p>
      </div>

      {/* Tab navigation */}
      <ImportTabs />

      {/* Tab content */}
      <div>{children}</div>
    </div>
  );
}
