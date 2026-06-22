import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { CreateLeadForm } from './CreateLeadForm';

export default async function LeadsPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('leads');

  const leads = await db
    .select({
      id:        crmLeads.id,
      fullName:  crmLeads.fullName,
      email:     crmLeads.email,
      phone:     crmLeads.phone,
      status:    crmLeads.status,
      source:    crmLeads.source,
      notes:     crmLeads.notes,
      createdAt: crmLeads.createdAt,
    })
    .from(crmLeads)
    .where(eq(crmLeads.orgId, ctx.orgId))
    .orderBy(desc(crmLeads.createdAt))
    .limit(50);

  const statuses = ['new', 'contacted', 'qualified', 'lost'] as const;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('newTitle')}</h2>
        <CreateLeadForm />
      </Card>

      {leads.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {statuses.map(status => {
            const statusLeads = leads.filter(l => l.status === status);
            return (
              <div key={status}>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{status} ({statusLeads.length})</h3>
                <div className="space-y-2">
                  {statusLeads.map(lead => (
                    <div key={lead.id} className="border border-slate-200 rounded-lg p-3 bg-white text-sm">
                      <p className="font-medium text-slate-900">{lead.fullName}</p>
                      {lead.email && <p className="text-xs text-slate-500 mt-0.5">{lead.email}</p>}
                      {lead.source && <p className="text-xs text-slate-400">{t('source')}: {lead.source}</p>}
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
