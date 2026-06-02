/**
 * Tenant activity feed aggregator.
 * Merges events from payments, incidents, tasks, sanctions, and WhatsApp messages
 * into a single timeline ordered by created_at desc.
 * No new DB table — uses existing tables.
 *
 * AC3: buildTenantActivityFeed accepts already-fetched arrays for payments,
 * incidents, tasks, and sanctions so no duplicate DB round-trips are issued.
 * Only whatsapp_messages remains as the single DB query inside this function,
 * because those messages are fetched separately by conversation_id elsewhere
 * and the activity feed needs them joined via whatsapp_conversations.
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

// Minimal shapes of the pre-fetched rows that the builder needs.
// The page fetches wider rows (select('*') or named columns); these interfaces
// only declare the fields the builder actually reads so TypeScript stays strict.

export interface PaymentRow {
  id: string;
  amount: number | string;
  status: string;
  created_at: string;
}

export interface IncidentRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

export interface SanctionRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  amount: number | string | null;
  created_at: string;
}

export interface BuildFeedArgs {
  supabase: SupabaseClient;
  tenantId: string;
  orgId: string;
  payments: PaymentRow[];
  incidents: IncidentRow[];
  tasks: TaskRow[];
  sanctions: SanctionRow[];
}

const FEED_LIMIT = 50;

/**
 * Build the activity timeline in memory from already-fetched arrays.
 * Only whatsapp_messages is still fetched from the DB here, because the
 * conversation-level messages fetched by the page use a different query
 * (by conversation_id) and lack the join needed for the activity timeline.
 */
export async function buildTenantActivityFeed({
  supabase,
  tenantId,
  orgId,
  payments,
  incidents,
  tasks,
  sanctions,
}: BuildFeedArgs): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];

  // Payments — from pre-fetched array (no DB round-trip)
  for (const p of payments) {
    events.push({
      id: p.id,
      type: 'payment',
      label: `Payment — $${Number(p.amount).toLocaleString('en-US')}`,
      status: p.status,
      createdAt: p.created_at,
    });
  }

  // Incidents — from pre-fetched array (no DB round-trip)
  for (const i of incidents) {
    events.push({
      id: i.id,
      type: 'incident',
      label: `Incident — ${i.title}`,
      status: i.status,
      createdAt: i.created_at,
    });
  }

  // Tenant tasks — from pre-fetched array (no DB round-trip)
  for (const t of tasks) {
    events.push({
      id: t.id,
      type: 'task',
      label: `Task — ${t.title}`,
      status: t.status,
      createdAt: t.created_at,
    });
  }

  // Sanctions — from pre-fetched array (no DB round-trip)
  for (const s of sanctions) {
    const detail = s.kind === 'monetary' ? `$${Number(s.amount).toLocaleString('en-US')}` : 'Warning';
    events.push({
      id: s.id,
      type: 'sanction',
      label: `Sanction — ${s.title}`,
      detail,
      status: s.status,
      createdAt: s.created_at,
    });
  }

  // WhatsApp messages (direction=inbound — tenant-initiated).
  // Remains as the only DB query: the page fetches messages by conversation_id
  // but the activity feed needs them joined via whatsapp_conversations to
  // resolve tenant_id, which is a different query shape.
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
