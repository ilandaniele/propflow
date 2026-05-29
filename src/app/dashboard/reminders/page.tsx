import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';

export default async function RemindersPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const { data: reminders } = await supabase
    .from('reminders')
    .select('id, type, target_type, channel, scheduled_for, sent_at, status, message_preview')
    .eq('org_id', ctx.orgId)
    .order('scheduled_for', { ascending: false })
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Reminders</h1>
        <p className="text-sm text-slate-500">Lease-renewal and payment-due reminders are sent automatically at 08:00 UTC daily.</p>
      </div>

      {(reminders ?? []).length === 0 ? (
        <EmptyState title="No reminders yet" description="Lease-renewal and payment-due reminders will appear here after the daily cron runs." />
      ) : (
        <div className="space-y-3">
          {(reminders ?? []).map((r) => (
            <Card key={r.id} padding="md">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-slate-900 capitalize">{r.type.replace('_', ' ')}</p>
                  <p className="text-xs text-slate-500 mt-0.5">For: {r.target_type} · Channel: {r.channel} · Scheduled: {r.scheduled_for}</p>
                  {r.message_preview && <p className="text-xs text-slate-600 mt-1 line-clamp-1">{r.message_preview}</p>}
                </div>
                <StatusPill status={r.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
