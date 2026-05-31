import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';

interface Contract {
  id: string;
  monthly_rent: number;
  start_date: string;
  end_date: string;
  status: string;
  document_url?: string | null;
}

export function ContractsTab({ contracts }: { contracts: Contract[] }) {
  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
        {contracts.length === 0 ? (
          <p className="text-sm text-slate-400">No contracts</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {contracts.map((c) => (
              <div key={c.id} className="py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">${Number(c.monthly_rent).toLocaleString()}/mo</p>
                  <p className="text-xs text-slate-500">{c.start_date} → {c.end_date}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={c.status} />
                  {c.document_url && (
                    <a
                      href={`/api/contracts/${c.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-600 hover:text-brand-800 underline"
                    >
                      Download PDF
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
