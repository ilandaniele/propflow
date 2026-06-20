import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
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

  const supabase = await createClient();

  // Fetch contract IDs for this specific tenant first.
  // signature_requests has no tenant_id column — it links to tenants via
  // contract_id. Filtering by contract IDs scopes the result to this tenant
  // and prevents an admin viewing tenant A from seeing requests for other
  // tenants in the same org (B1 fix).
  const tenantContractsRes = await supabase
    .from('contracts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('org_id', ctx.orgId);

  const tenantContractIds = (tenantContractsRes.data ?? []).map((c) => c.id);

  const [signatureReqRes, contractsRes] = await Promise.all([
    tenantContractIds.length > 0
      ? supabase
          .from('signature_requests')
          .select('id, signer_email, status, sent_at')
          .eq('org_id', ctx.orgId)
          .in('contract_id', tenantContractIds)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('org_id', ctx.orgId),
  ]);

  const signatureRequests = signatureReqRes.data ?? [];
  const contractCount = contractsRes.count ?? 0;
  const t = await getTranslations('tenantTabs.documentsTab');

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
        {signatureRequests.length === 0 ? (
          <p className="text-sm text-slate-400">{t('noSignatureRequests')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {signatureRequests.map((sr) => (
              <div key={sr.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{sr.signer_email}</p>
                  <p className="text-xs text-slate-500">
                    {t('sentLabel')} {new Date(sr.sent_at).toLocaleDateString()}
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
