import { sql, type SQL } from 'drizzle-orm';
import { listings, unitExternalBlocks } from '@/lib/db/schema';

/** Listing condition: its unit has no channel booking (Airbnb/Booking/Vrbo) covering `today`. Listings without a unit always pass. */
export function notBookedOnChannels(today: string): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${unitExternalBlocks} WHERE ${unitExternalBlocks.unitId} = ${listings.unitId} AND ${unitExternalBlocks.startsOn} <= ${today} AND ${unitExternalBlocks.endsOn} > ${today})`;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
