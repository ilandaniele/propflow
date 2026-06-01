import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface Sanction {
  id: string;
  kind: string;
  title: string;
  reason: string;
  amount: number | null;
  status: string;
  created_at: string;
}

export function SanctionsTab({ sanctions }: { sanctions: Sanction[] }) {
  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>Sanctions</CardTitle></CardHeader>
        {sanctions.length === 0 ? (
          <p className="text-sm text-slate-400">No sanctions</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {sanctions.map((s) => (
              <div key={s.id} className="py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-900">{s.title}</p>
                    <Badge variant={s.kind === 'monetary' ? 'danger' : 'warning'}>
                      {s.kind}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{s.reason}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{new Date(s.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.amount && <span className="text-sm font-medium text-slate-900">${Number(s.amount).toLocaleString()}</span>}
                  <Badge variant={
                    s.status === 'approved' ? 'danger' :
                    s.status === 'disputed' ? 'warning' :
                    s.status === 'resolved' ? 'success' :
                    'default'
                  }>
                    {s.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
