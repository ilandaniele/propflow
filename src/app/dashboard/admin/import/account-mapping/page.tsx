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
import { db } from '@/lib/db';
import { accountMappings } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { AccountMappingForm } from './AccountMappingForm';

export const dynamic = 'force-dynamic';

export default async function AccountMappingPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('adminImport.accountMapping');

  const rows = await db
    .select({
      id:               accountMappings.id,
      externalAccount:  accountMappings.externalAccount,
      internalCategory: accountMappings.internalCategory,
      isIncome:         accountMappings.isIncome,
      affectsNetProfit: accountMappings.affectsNetProfit,
    })
    .from(accountMappings)
    .where(eq(accountMappings.orgId, ctx.orgId))
    .orderBy(asc(accountMappings.externalAccount));

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Add new mapping */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">{t('addTitle')}</h2>
        <p className="text-sm text-slate-500">{t('addSubtitle')}</p>
        <AccountMappingForm />
      </div>

      {/* Existing mappings */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">
            {t('savedTitle')}
            <span className="ml-2 bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
              {rows.length}
            </span>
          </h2>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            {t('emptyState')}
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="account-mappings-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colExternal')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colInternal')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colType')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colAffectsNet')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-700 text-sm">{row.externalAccount}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.internalCategory ?? <span className="text-slate-400 italic">{t('unassigned')}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      row.isIncome
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {row.isIncome ? t('income') : t('expense')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {row.affectsNetProfit ? t('yes') : t('no')}
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
