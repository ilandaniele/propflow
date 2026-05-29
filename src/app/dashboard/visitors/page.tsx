import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { CreateVisitorForm } from './CreateVisitorForm';

export default async function AdminVisitorsPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const { data: visitors } = await supabase
    .from('visitor_logs')
    .select('id, visitor_name, visit_date, entry_time, exit_time, purpose, unit_id')
    .eq('org_id', ctx.orgId)
    .order('visit_date', { ascending: false })
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Visitor Log</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">Log Visitor</h2>
        <CreateVisitorForm />
      </Card>

      {(visitors ?? []).length === 0 ? (
        <EmptyState title="No visitors yet" description="Register visitor entries to maintain an access log." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="py-2 pr-4 font-medium text-slate-600">Visitor</th>
                <th className="py-2 pr-4 font-medium text-slate-600">Date</th>
                <th className="py-2 pr-4 font-medium text-slate-600">Entry</th>
                <th className="py-2 pr-4 font-medium text-slate-600">Exit</th>
                <th className="py-2 font-medium text-slate-600">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {(visitors ?? []).map((v) => (
                <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 pr-4 text-slate-900">{v.visitor_name}</td>
                  <td className="py-2 pr-4 text-slate-600">{v.visit_date}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.entry_time ? new Date(v.entry_time).toLocaleTimeString() : '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.exit_time ? new Date(v.exit_time).toLocaleTimeString() : '—'}</td>
                  <td className="py-2 text-slate-500">{v.purpose ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
