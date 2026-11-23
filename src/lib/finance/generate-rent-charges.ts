import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { charges, contracts, rentScheduleSettings } from '@/lib/db/schema';
import { rentChargesFor } from './rent-schedule';

/** Only orgs that opted in (rent_schedule_settings.enabled): new charges feed payment_due reminders to tenants. */
export async function generateRentCharges(today: string): Promise<number> {
  const activeContracts = await db
    .select({
      id: contracts.id,
      orgId: contracts.orgId,
      tenantId: contracts.tenantId,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      monthlyRent: contracts.monthlyRent,
    })
    .from(contracts)
    .innerJoin(rentScheduleSettings, eq(rentScheduleSettings.orgId, contracts.orgId))
    .where(and(eq(contracts.status, 'active'), eq(rentScheduleSettings.enabled, true)));

  const rows = rentChargesFor(activeContracts, today);
  const statements = chunk(rows, rowsPerInsert(charges)).map((part) =>
    db.insert(charges).values(part).onConflictDoNothing().returning({ id: charges.id }),
  );
  const batch = asBatch(statements);
  if (!batch) return 0;

  const results = await db.batch(batch);
  return results.reduce((total, inserted) => total + (inserted as unknown[]).length, 0);
}
