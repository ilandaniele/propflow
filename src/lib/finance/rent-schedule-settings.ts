import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rentScheduleSettings } from '@/lib/db/schema';

export async function isRentScheduleEnabled(orgId: string): Promise<boolean> {
  const rows = await db.select({ enabled: rentScheduleSettings.enabled }).from(rentScheduleSettings).where(eq(rentScheduleSettings.orgId, orgId)).limit(1);
  return rows[0]?.enabled ?? false;
}

export async function setRentScheduleEnabled(orgId: string, enabled: boolean): Promise<void> {
  const updatedAt = new Date();
  await db.insert(rentScheduleSettings).values({ orgId, enabled, updatedAt })
    .onConflictDoUpdate({ target: rentScheduleSettings.orgId, set: { enabled, updatedAt } });
}
