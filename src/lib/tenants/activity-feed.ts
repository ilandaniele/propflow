/**
 * Tenant activity feed aggregator.
 * Merges events from payments, incidents, tasks, sanctions, and WhatsApp messages
 * into a single timeline ordered by created_at desc.
 * No new DB table — uses existing tables.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type ActivityEventType =
  | 'payment'
  | 'incident'
  | 'task'
  | 'sanction'
  | 'whatsapp'
  | 'note';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  label: string;
  detail?: string;
  status?: string;
  createdAt: string;
}

const FEED_LIMIT = 50;

/**
 * Fetch the last 50 activity events for a tenant.
 * Uses the anon (RLS-scoped) Supabase client.
 */
export async function getTenantActivityFeed(
  supabase: SupabaseClient,
  tenantId: string,
  orgId: string
): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];

  // Payments
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20);

  for (const p of payments ?? []) {
    events.push({
      id: p.id,
      type: 'payment',
      label: `Payment — $${Number(p.amount).toLocaleString()}`,
      status: p.status,
      createdAt: p.created_at,
    });
  }

  // Incidents
  const { data: incidents } = await supabase
    .from('incidents')
    .select('id, title, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20);

  for (const i of incidents ?? []) {
    events.push({
      id: i.id,
      type: 'incident',
      label: `Incident — ${i.title}`,
      status: i.status,
      createdAt: i.created_at,
    });
  }

  // Tenant tasks
  const { data: tasks } = await supabase
    .from('tenant_tasks')
    .select('id, title, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20);

  for (const t of tasks ?? []) {
    events.push({
      id: t.id,
      type: 'task',
      label: `Task — ${t.title}`,
      status: t.status,
      createdAt: t.created_at,
    });
  }

  // Sanctions
  const { data: sanctions } = await supabase
    .from('sanctions')
    .select('id, title, kind, status, amount, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20);

  for (const s of sanctions ?? []) {
    const detail = s.kind === 'monetary' ? `$${Number(s.amount).toLocaleString()}` : 'Warning';
    events.push({
      id: s.id,
      type: 'sanction',
      label: `Sanction — ${s.title}`,
      detail,
      status: s.status,
      createdAt: s.created_at,
    });
  }

  // WhatsApp messages (direction=inbound — tenant-initiated)
  const { data: messages } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, classification, status, created_at, conversation:whatsapp_conversations!inner(tenant_id)')
    .eq('whatsapp_conversations.tenant_id', tenantId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20);

  for (const m of messages ?? []) {
    events.push({
      id: m.id,
      type: 'whatsapp',
      label: `WhatsApp — ${m.direction === 'inbound' ? 'Inbound' : 'Outbound'}`,
      detail: m.classification ?? undefined,
      status: m.status,
      createdAt: m.created_at,
    });
  }

  // Sort all events by createdAt desc, take top FEED_LIMIT
  return events
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, FEED_LIMIT);
}
