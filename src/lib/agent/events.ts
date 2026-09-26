/**
 * agent_events — the inbox timeline (handoffs, mode changes, suggestions,
 * attribution, window-closed, turn errors). Recording an event must never
 * break the turn or action that triggered it, so failures are swallowed and
 * logged rather than thrown.
 */

import { db } from '@/lib/db';
import { agentEvents } from '@/lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { log } from '@/lib/log';
import type { AgentEventKind } from './types';

export interface RecordAgentEventArgs {
  orgId: string;
  sessionId: string;
  kind: AgentEventKind;
  data?: Record<string, unknown>;
  actorProfileId?: string | null;
}

export async function recordAgentEvent(args: RecordAgentEventArgs): Promise<void> {
  try {
    await db.insert(agentEvents).values({
      orgId: args.orgId,
      sessionId: args.sessionId,
      kind: args.kind,
      data: args.data ?? {},
      actorProfileId: args.actorProfileId ?? null,
    });
  } catch (err) {
    log.error('[agent/events] recordAgentEvent failed', {
      sessionId: args.sessionId,
      kind: args.kind,
      err: (err as Error).message,
    });
  }
}

export interface AgentEventRecord {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  actorProfileId: string | null;
  createdAt: Date;
}

export async function listSessionEvents(orgId: string, sessionId: string, limit = 100): Promise<AgentEventRecord[]> {
  const rows = await db
    .select({
      id: agentEvents.id,
      kind: agentEvents.kind,
      data: agentEvents.data,
      actorProfileId: agentEvents.actorProfileId,
      createdAt: agentEvents.createdAt,
    })
    .from(agentEvents)
    .where(and(eq(agentEvents.sessionId, sessionId), eq(agentEvents.orgId, orgId)))
    .orderBy(asc(agentEvents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    data: (r.data as Record<string, unknown>) ?? {},
    actorProfileId: r.actorProfileId,
    createdAt: r.createdAt,
  }));
}
