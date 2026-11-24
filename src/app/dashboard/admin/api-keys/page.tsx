import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listApiKeys } from '@/lib/api-keys/queries';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { CreateApiKeyForm, RevokeApiKeyForm } from './ApiKeyForms';

export const metadata: Metadata = { title: 'API' };

const ENDPOINTS = ['/api/v1/properties', '/api/v1/units', '/api/v1/tenants', '/api/v1/payments?month=YYYY-MM'];

const formatDate = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : '—');

export default async function ApiKeysPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('apiKeys');
  const keys = await listApiKeys(ctx.orgId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('createTitle')}</h2>
        <CreateApiKeyForm />
      </Card>

      {keys.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colName')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colPrefix')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colCreated')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colLastUsed')}</th>
                <th className="py-2 font-medium text-slate-600">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-slate-50">
                  <td className="py-2 pr-4 text-slate-900">{key.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-600">pf_{key.prefix}_…</td>
                  <td className="py-2 pr-4 text-slate-500">{formatDate(key.createdAt)}</td>
                  <td className="py-2 pr-4 text-slate-500">{formatDate(key.lastUsedAt)}</td>
                  <td className="py-2">
                    {key.revokedAt ? <span className="text-slate-400">{t('revoked')}</span> : <RevokeApiKeyForm id={key.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-2">{t('docsTitle')}</h2>
        <p className="text-sm text-slate-600 mb-3">{t('docsAuth')}</p>
        <code className="block rounded bg-slate-50 px-3 py-2 text-xs text-slate-800">Authorization: Bearer pf_xxxxxxxx_…</code>
        <ul className="mt-3 space-y-1 font-mono text-xs text-slate-700">
          {ENDPOINTS.map((endpoint) => <li key={endpoint}>GET {endpoint}</li>)}
        </ul>
        <p className="text-sm text-slate-600 mt-3">{t('docsPagination')}</p>
      </Card>
    </div>
  );
}
