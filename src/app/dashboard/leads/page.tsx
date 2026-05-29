import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { CreateLeadForm } from './CreateLeadForm';

export default async function LeadsPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from('crm_leads')
    .select('id, full_name, email, phone, status, source, notes, created_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  const statuses = ['new', 'contacted', 'qualified', 'lost'] as const;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">CRM Leads</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">New Lead</h2>
        <CreateLeadForm />
      </Card>

      {(leads ?? []).length === 0 ? (
        <EmptyState title="No leads yet" description="Track prospective tenants through your CRM pipeline." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {statuses.map(status => {
            const statusLeads = (leads ?? []).filter(l => l.status === status);
            return (
              <div key={status}>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{status} ({statusLeads.length})</h3>
                <div className="space-y-2">
                  {statusLeads.map(lead => (
                    <div key={lead.id} className="border border-slate-200 rounded-lg p-3 bg-white text-sm">
                      <p className="font-medium text-slate-900">{lead.full_name}</p>
                      {lead.email && <p className="text-xs text-slate-500 mt-0.5">{lead.email}</p>}
                      {lead.source && <p className="text-xs text-slate-400">Source: {lead.source}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
