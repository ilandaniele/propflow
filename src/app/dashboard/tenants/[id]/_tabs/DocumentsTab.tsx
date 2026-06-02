import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
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

  const [signatureReqRes, contractsRes] = await Promise.all([
    supabase
      .from('signature_requests')
      .select('id, signer_email, status, sent_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('org_id', ctx.orgId),
  ]);

  const signatureRequests = signatureReqRes.data ?? [];
  const contractCount = contractsRes.count ?? 0;

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>Contract PDFs</CardTitle></CardHeader>
        {contractCount === 0 ? (
          <p className="text-sm text-slate-400">No contracts</p>
        ) : (
          <p className="text-sm text-slate-600">
            {contractCount} contract(s) available. See the Contracts tab for download links.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Signature Requests</CardTitle></CardHeader>
        {signatureRequests.length === 0 ? (
          <p className="text-sm text-slate-400">No signature requests</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {signatureRequests.map((sr) => (
              <div key={sr.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{sr.signer_email}</p>
                  <p className="text-xs text-slate-500">
                    Sent: {new Date(sr.sent_at).toLocaleDateString()}
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
