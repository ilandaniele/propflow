import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';

interface SignatureRequest {
  id: string;
  signer_email: string;
  status: string;
  sent_at: string;
}

interface DocumentsTabProps {
  signatureRequests: SignatureRequest[];
  contractCount: number;
}

export function DocumentsTab({ signatureRequests, contractCount }: DocumentsTabProps) {
  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>Contract PDFs</CardTitle></CardHeader>
        {contractCount === 0 ? (
          <p className="text-sm text-slate-400">No contracts</p>
        ) : (
          <p className="text-sm text-slate-600">{contractCount} contract(s) available. See the Contracts tab for download links.</p>
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
                  <p className="text-xs text-slate-500">Sent: {new Date(sr.sent_at).toLocaleDateString()}</p>
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
