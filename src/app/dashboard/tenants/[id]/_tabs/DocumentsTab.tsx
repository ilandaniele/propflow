import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts, signatureRequests } from '@/lib/db/schema';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches signature requests and contract count
 * for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function DocumentsTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  // Fetch tenant contract IDs first — signature_requests has no tenant_id column,
  // it links to tenants via contract_id. Filtering by contract IDs scopes the result
  // to this tenant and prevents cross-tenant data exposure (B1 fix).
  const tenantContracts = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.orgId, ctx.orgId)));

  const tenantContractIds = tenantContracts.map((c) => c.id);
  const contractCount = tenantContracts.length;

  const [signatureRows, t] = await Promise.all([
    tenantContractIds.length > 0
      ? db
          .select({
            id:          signatureRequests.id,
            signerEmail: signatureRequests.signerEmail,
            status:      signatureRequests.status,
            sentAt:      signatureRequests.sentAt,
          })
          .from(signatureRequests)
          .where(and(
            eq(signatureRequests.orgId, ctx.orgId),
            inArray(signatureRequests.contractId, tenantContractIds),
          ))
          .orderBy(desc(signatureRequests.createdAt))
          .limit(20)
      : Promise.resolve([]),
    getTranslations('tenantTabs.documentsTab'),
  ]);

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>{t('contractPdfsTitle')}</CardTitle></CardHeader>
        {contractCount === 0 ? (
          <p className="text-sm text-slate-400">{t('noContracts')}</p>
        ) : (
          <p className="text-sm text-slate-600">
            {t('contractsAvailable', { count: contractCount })}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('signatureRequestsTitle')}</CardTitle></CardHeader>
        {signatureRows.length === 0 ? (
          <p className="text-sm text-slate-400">{t('noSignatureRequests')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {signatureRows.map((sr) => (
              <div key={sr.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{sr.signerEmail}</p>
                  <p className="text-xs text-slate-500">
                    {t('sentLabel')} {sr.sentAt ? new Date(sr.sentAt).toLocaleDateString() : '—'}
                  </p>
                </div>
                <StatusPill status={sr.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
