import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ownerAssistantMessages } from '@/lib/db/schema';

export interface AssistantActivity {
  id: string;
  kind: string;
  outcome: string;
  createdAt: Date;
}

export async function listAssistantActivity(orgId: string, limit = 20): Promise<AssistantActivity[]> {
  return db
    .select({ id: ownerAssistantMessages.id, kind: ownerAssistantMessages.kind, outcome: ownerAssistantMessages.outcome, createdAt: ownerAssistantMessages.createdAt })
    .from(ownerAssistantMessages)
    .where(eq(ownerAssistantMessages.orgId, orgId))
    .orderBy(desc(ownerAssistantMessages.createdAt))
    .limit(limit);
}
