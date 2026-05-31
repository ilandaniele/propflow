import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import Link from 'next/link';

interface Incident {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
}

export function IncidentsTab({ incidents }: { incidents: Incident[] }) {
  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>Incidents</CardTitle></CardHeader>
        {incidents.length === 0 ? (
          <p className="text-sm text-slate-400">No incidents</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {incidents.map((i) => (
              <div key={i.id} className="py-3 flex items-center justify-between">
                <div>
                  <Link
                    href={`/dashboard/incidents/${i.id}`}
                    className="text-sm font-medium text-slate-900 hover:text-brand-600 transition-colors"
                  >
                    {i.title}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">{i.category} · {new Date(i.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <PriorityPill priority={i.priority} />
                  <StatusPill status={i.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
