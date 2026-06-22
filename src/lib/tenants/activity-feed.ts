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
 *
 * Migrated from Supabase client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { whatsappMessages, whatsappConversations } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

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
 * Only whatsapp_messages is still fetched from the DB here, joined via
 * whatsapp_conversations to resolve tenant_id.
 */
export async function buildTenantActivityFeed({
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

  // WhatsApp messages joined via whatsapp_conversations to resolve tenant_id
  const messages = await db
    .select({
      id: whatsappMessages.id,
      direction: whatsappMessages.direction,
      classification: whatsappMessages.classification,
      status: whatsappMessages.status,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .innerJoin(
      whatsappConversations,
      eq(whatsappMessages.conversationId, whatsappConversations.id),
    )
    .where(and(
      eq(whatsappConversations.tenantId, tenantId),
      eq(whatsappMessages.orgId, orgId),
    ))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(20);

  for (const m of messages) {
    events.push({
      id: m.id,
      type: 'whatsapp',
      label: `WhatsApp — ${m.direction === 'inbound' ? 'Inbound' : 'Outbound'}`,
      detail: m.classification ?? undefined,
      status: m.status,
      createdAt: m.createdAt ? String(m.createdAt) : '',
    });
  }

  // Sort all events by createdAt desc, take top FEED_LIMIT
  return events
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, FEED_LIMIT);
}
