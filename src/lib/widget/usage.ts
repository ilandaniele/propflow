/**
 * agent_web_usage_daily — the DB-backed backstop for the web channel's daily
 * caps (abuse control §0.10): survives restarts and multiple instances,
 * unlike the in-memory rate limiter.
 */

import { db } from '@/lib/db';
import { agentWebUsageDaily } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Atomic upsert: INSERT ... ON CONFLICT DO UPDATE +1 RETURNING, keyed by (orgId, UTC day). */
export async function incrementWebUsage(
  orgId: string,
  field: 'sessions' | 'messages',
  cap: number,
): Promise<{ allowed: boolean; count: number }> {
  const day = utcDay();
  const column = field === 'sessions' ? agentWebUsageDaily.sessions : agentWebUsageDaily.messages;

  const rows = await db
    .insert(agentWebUsageDaily)
    .values({ orgId, day, sessions: field === 'sessions' ? 1 : 0, messages: field === 'messages' ? 1 : 0 })
    .onConflictDoUpdate({
      target: [agentWebUsageDaily.orgId, agentWebUsageDaily.day],
      set: { [field]: sql`${column} + 1` },
    })
    .returning({ sessions: agentWebUsageDaily.sessions, messages: agentWebUsageDaily.messages });

  const count = field === 'sessions' ? rows[0].sessions : rows[0].messages;
  return { allowed: count <= cap, count };
}

/** Test/inspection helper — today's counters for an org, without incrementing. */
export async function getWebUsageToday(orgId: string): Promise<{ sessions: number; messages: number }> {
  const rows = await db
    .select({ sessions: agentWebUsageDaily.sessions, messages: agentWebUsageDaily.messages })
    .from(agentWebUsageDaily)
    .where(and(eq(agentWebUsageDaily.orgId, orgId), eq(agentWebUsageDaily.day, utcDay())))
    .limit(1);
  return rows[0] ?? { sessions: 0, messages: 0 };
}
