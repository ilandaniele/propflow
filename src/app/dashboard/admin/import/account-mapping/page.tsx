/**
 * /dashboard/admin/import/account-mapping
 *
 * Account Mapping (AC20):
 * - Table of account_mappings
 * - Add new: external_account + internal_category + is_income checkbox
 * - Pre-populate dropdown with the 14 standard internal categories from spec
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { AccountMappingForm } from './AccountMappingForm';

export const dynamic = 'force-dynamic';

interface AccountMappingRow {
  id: string;
  external_account: string;
  internal_category: string | null;
  is_income: boolean;
  affects_net_profit: boolean;
}

export default async function AccountMappingPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login');
  }

  const supabase = await createClient();

  const { data: mappings, error } = await supabase
    .from('account_mappings')
    .select('id, external_account, internal_category, is_income, affects_net_profit')
    .order('external_account', { ascending: true });

  const rows: AccountMappingRow[] = mappings ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Add new mapping */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Agregar mapeo de cuenta</h2>
        <p className="text-sm text-slate-500">
          Vincula un código de cuenta externo con una categoría interna del plan de cuentas.
        </p>
        <AccountMappingForm />
      </div>

      {/* Existing mappings */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">
            Mapeos guardados
            <span className="ml-2 bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
              {rows.length}
            </span>
          </h2>
        </div>

        {error && (
          <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-sm text-red-700" role="alert">
            Error al cargar mapeos.
          </div>
        )}

        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            No hay mapeos de cuentas aún.
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="account-mappings-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Código externo</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Categoría interna</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Afecta neto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-700 text-sm">{row.external_account}</td>
                  <td className="px-4 py-3 text-slate-600">{row.internal_category ?? <span className="text-slate-400 italic">Sin asignar</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      row.is_income
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {row.is_income ? 'Ingreso' : 'Gasto'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {row.affects_net_profit ? 'Sí' : 'No'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
