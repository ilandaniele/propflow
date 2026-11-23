import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { charges, contracts } from '@/lib/db/schema';
import { rentChargesFor } from './rent-schedule';

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
    .where(eq(contracts.status, 'active'));

  const rows = rentChargesFor(activeContracts, today);
  const statements = chunk(rows, rowsPerInsert(charges)).map((part) =>
    db.insert(charges).values(part).onConflictDoNothing().returning({ id: charges.id }),
  );
  const batch = asBatch(statements);
  if (!batch) return 0;

  const results = await db.batch(batch);
  return results.reduce((total, inserted) => total + (inserted as unknown[]).length, 0);
}
